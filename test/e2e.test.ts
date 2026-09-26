import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, type CallToolResult } from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  getDefaultEnvironment
} from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeManus, type FakeTask } from "./fake-manus.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const entry = join(root, "dist", "main.js");
const caption =
  'Golden hour at the pier 🌅\n\nShot on 35mm. "No filter" & <no edits>\n#travel #film';

let fake: FakeManus;
let home: string;
let client: Client;
const clients: Client[] = [];

async function connect(env: Record<string, string> = {}): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: {
      ...getDefaultEnvironment(),
      HOME: home,
      MANUS_API_KEY: fake.apiKey,
      MANUS_BASE_URL: fake.url,
      ...env
    },
    stderr: "pipe"
  });
  const connected = new Client({ name: "e2e", version: "1.0.0" });
  await connected.connect(transport);
  clients.push(connected);
  return connected;
}

async function writeVideo(name: string, bytes: Buffer): Promise<string> {
  const path = join(home, name);
  await writeFile(path, bytes);
  return path;
}

function textOf(result: CallToolResult): string {
  return result.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
}

function postReel(videoPath: string, text = caption) {
  return client.callTool({
    name: "post_reel",
    arguments: { videoPath, caption: text }
  });
}

function statusUpdate(agentStatus: string, waitingDescription?: string) {
  return {
    type: "status_update",
    status_update: {
      agent_status: agentStatus,
      ...(waitingDescription === undefined
        ? {}
        : {
            status_detail: {
              waiting_for_event_type: "messageAskUser",
              waiting_description: waitingDescription
            }
          })
    }
  };
}

function assistantMessage(content: string) {
  return { type: "assistant_message", assistant_message: { content } };
}

function errorMessage(content: string) {
  return {
    type: "error_message",
    error_message: { error_type: "agent_error", content }
  };
}

function publishResult(
  success: boolean,
  value: { published: boolean; post_url: string | null; error: string | null },
  error: string | null = null
) {
  return {
    type: "structured_output_result",
    structured_output_result: { success, value, error }
  };
}

beforeAll(async () => {
  execFileSync("npm", ["run", "build"], { cwd: root, stdio: "pipe" });
  fake = await FakeManus.start();
  home = await mkdtemp(join(tmpdir(), "instagram-mcp-e2e-"));
  client = await connect();
}, 60_000);

afterAll(async () => {
  await Promise.all(clients.map((item) => item.close()));
  await fake.close();
  await rm(home, { recursive: true, force: true });
});

beforeEach(() => {
  fake.reset();
  fake.setConnectors([
    { id: "conn-gmail", name: "Gmail", type: "builtin" },
    { id: "conn-instagram", name: "instagram", type: "builtin" }
  ]);
});

describe("tools/list", () => {
  it("exposes exactly post_reel and get_post_status", async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "get_post_status",
      "post_reel"
    ]);
    const postReelTool = tools.find((tool) => tool.name === "post_reel");
    expect(postReelTool?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        videoPath: { type: "string", minLength: 1 },
        caption: { type: "string", maxLength: 2200 }
      },
      required: ["videoPath", "caption"]
    });
    expect(postReelTool?.annotations).toMatchObject({ readOnlyHint: false });
    const statusTool = tools.find((tool) => tool.name === "get_post_status");
    expect(statusTool?.inputSchema).toMatchObject({
      type: "object",
      properties: { taskId: { type: "string", minLength: 1 } },
      required: ["taskId"]
    });
    expect(statusTool?.annotations).toMatchObject({ readOnlyHint: true });
    expect(fake.requests).toEqual([]);
  });
});

describe("post_reel", () => {
  it("uploads the video and creates a non-interactive Manus task", async () => {
    const bytes = randomBytes(300_000);
    const videoPath = await writeVideo("sunset.mp4", bytes);

    const result = await postReel(videoPath);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      taskId: "task_1",
      taskUrl: "https://manus.im/app/task_1"
    });
    expect(textOf(result)).toContain("https://manus.im/app/task_1");

    expect(
      fake.requests.map((request) => `${request.method} ${request.path}`)
    ).toEqual([
      "GET /v2/connector.list",
      "POST /v2/file.upload",
      `PUT /upload/${fake.uploads[0]?.fileId ?? ""}`,
      "POST /v2/task.create"
    ]);
    for (const request of fake.apiRequests()) {
      expect(request.headers["x-manus-api-key"]).toBe("test-key");
    }
    const upload = fake.requests.find((request) => request.method === "PUT");
    expect(upload?.headers["x-manus-api-key"]).toBeUndefined();

    expect(fake.apiRequests("file.upload")[0]?.body).toEqual({
      filename: "sunset.mp4"
    });
    expect(fake.uploads).toHaveLength(1);
    expect(fake.uploads[0]?.contentType).toBe("video/mp4");
    expect(fake.uploads[0]?.bytes.equals(bytes)).toBe(true);

    const body = fake.apiRequests("task.create")[0]?.body;
    expect(body).toMatchObject({
      interactive_mode: false,
      message: {
        connectors: ["conn-instagram"],
        content: [
          { type: "text", text: expect.stringContaining(caption) as unknown },
          {
            type: "file",
            file_id: fake.uploads[0]?.fileId,
            filename: "sunset.mp4",
            mime_type: "video/mp4"
          }
        ]
      },
      structured_output_schema: {
        type: "object",
        required: ["published", "post_url", "error"]
      }
    });
  });

  it("expands ~/ to the home directory", async () => {
    const bytes = randomBytes(1024);
    await writeVideo("from-home.mp4", bytes);

    const result = await postReel("~/from-home.mp4");

    expect(result.isError).toBeFalsy();
    expect(fake.uploads[0]?.filename).toBe("from-home.mp4");
    expect(fake.uploads[0]?.bytes.equals(bytes)).toBe(true);
  });

  it.each([
    {
      name: "a relative path",
      setup: () => Promise.resolve("videos/sunset.mp4"),
      error: 'videoPath must be an absolute path, got "videos/sunset.mp4"'
    },
    {
      name: "a non-mp4 file",
      setup: () => writeVideo("sunset.mov", randomBytes(16)),
      error: "videoPath must point to an .mp4 file"
    },
    {
      name: "a missing file",
      setup: () => Promise.resolve(join(home, "missing.mp4")),
      error: "No video file found"
    },
    {
      name: "a directory",
      setup: async () => {
        const path = join(home, "folder.mp4");
        await mkdir(path, { recursive: true });
        return path;
      },
      error: "No video file found"
    },
    {
      name: "an empty file",
      setup: () => writeVideo("empty.mp4", Buffer.alloc(0)),
      error: "is empty"
    }
  ])("rejects $name without calling Manus", async ({ setup, error }) => {
    const result = await postReel(await setup());

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(error);
    expect(fake.requests).toEqual([]);
  });

  it("rejects a caption longer than Instagram allows without calling Manus", async () => {
    const videoPath = await writeVideo("long.mp4", randomBytes(16));

    const result = await postReel(videoPath, "a".repeat(2201));

    expect(result.isError).toBe(true);
    expect(fake.requests).toEqual([]);
  });

  it("lists installed connectors when Instagram is not connected", async () => {
    fake.setConnectors([
      { id: "conn-gmail", name: "Gmail" },
      { id: "conn-notion", name: "Notion" }
    ]);
    const videoPath = await writeVideo("sunset.mp4", randomBytes(16));

    const result = await postReel(videoPath);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(
      'No Manus connector matches "Instagram". Installed connectors: Gmail, Notion.'
    );
    expect(fake.requests.map((request) => request.path)).toEqual([
      "/v2/connector.list"
    ]);
  });

  it("says none are installed when the account has no connectors", async () => {
    fake.setConnectors([]);
    const videoPath = await writeVideo("sunset.mp4", randomBytes(16));

    const result = await postReel(videoPath);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Installed connectors: none.");
  });

  it("refuses to guess between several Instagram connectors", async () => {
    fake.setConnectors([
      { id: "conn-ig-personal", name: "Instagram" },
      { id: "conn-ig-brand", name: "INSTAGRAM" }
    ]);
    const videoPath = await writeVideo("sunset.mp4", randomBytes(16));

    const result = await postReel(videoPath);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("conn-ig-personal, conn-ig-brand");
    expect(textOf(result)).toContain("MANUS_INSTAGRAM_CONNECTOR");
    expect(fake.uploads).toEqual([]);
    expect(fake.apiRequests("task.create")).toEqual([]);
  });

  it("uses the connector id from MANUS_INSTAGRAM_CONNECTOR", async () => {
    const pinned = await connect({
      MANUS_INSTAGRAM_CONNECTOR: "conn-ig-brand"
    });
    fake.setConnectors([
      { id: "conn-ig-personal", name: "Instagram" },
      { id: "conn-ig-brand", name: "Instagram" }
    ]);
    const videoPath = await writeVideo("sunset.mp4", randomBytes(16));

    const result = await pinned.callTool({
      name: "post_reel",
      arguments: { videoPath, caption }
    });

    expect(result.isError).toBeFalsy();
    expect(fake.apiRequests("task.create")[0]?.body).toMatchObject({
      message: { connectors: ["conn-ig-brand"] }
    });
  });

  it("surfaces Manus error envelopes", async () => {
    fake.fail(
      "task.create",
      429,
      "rate_limited",
      "Rate limit exceeded. Please retry after a short backoff."
    );
    const videoPath = await writeVideo("sunset.mp4", randomBytes(16));

    const result = await postReel(videoPath);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "Rate limit exceeded. Please retry after a short backoff."
    );
    expect(fake.apiRequests("task.create")).toHaveLength(1);
  });
});

describe("get_post_status", () => {
  const taskId = "task_status";
  const base = { taskId, taskUrl: "https://manus.im/app/task_status" };

  it.each<{ name: string; task: FakeTask; expected: Record<string, unknown> }>([
    {
      name: "running while Manus works",
      task: {
        status: "running",
        events: [statusUpdate("running"), assistantMessage("Uploading")]
      },
      expected: { state: "running" }
    },
    {
      name: "needs_attention with the latest waiting description",
      task: {
        status: "waiting",
        events: [
          statusUpdate("waiting", "Which Instagram account?"),
          statusUpdate("running"),
          statusUpdate("waiting", "Confirm posting to @brand")
        ]
      },
      expected: {
        state: "needs_attention",
        message: "Confirm posting to @brand"
      }
    },
    {
      name: "needs_attention with a fallback when Manus gives no reason",
      task: { status: "waiting", events: [statusUpdate("waiting")] },
      expected: {
        state: "needs_attention",
        message: "Manus is waiting for input. Open the task to respond."
      }
    },
    {
      name: "failed with the latest error message",
      task: {
        status: "error",
        events: [
          errorMessage("Transient upload hiccup"),
          statusUpdate("running"),
          errorMessage("Instagram rejected the video aspect ratio"),
          statusUpdate("error")
        ]
      },
      expected: {
        state: "failed",
        message: "Instagram rejected the video aspect ratio"
      }
    },
    {
      name: "running while background jobs continue after a stop",
      task: {
        status: "stopped",
        has_running_background_jobs: true,
        events: [statusUpdate("stopped")]
      },
      expected: { state: "running" }
    },
    {
      name: "published with the post URL",
      task: {
        status: "stopped",
        has_running_background_jobs: false,
        events: [
          statusUpdate("running"),
          assistantMessage("The Reel is live."),
          statusUpdate("stopped"),
          publishResult(true, {
            published: true,
            post_url: "https://www.instagram.com/reel/C0ffee123/",
            error: null
          })
        ]
      },
      expected: {
        state: "published",
        postUrl: "https://www.instagram.com/reel/C0ffee123/"
      }
    },
    {
      name: "failed when Manus reports the Reel was not published",
      task: {
        status: "stopped",
        events: [
          statusUpdate("stopped"),
          publishResult(true, {
            published: false,
            post_url: null,
            error: "Instagram session expired"
          })
        ]
      },
      expected: { state: "failed", message: "Instagram session expired" }
    },
    {
      name: "failed when structured output extraction fails",
      task: {
        status: "stopped",
        events: [
          statusUpdate("stopped"),
          publishResult(
            false,
            { published: false, post_url: null, error: null },
            "The task output did not contain a publish result"
          )
        ]
      },
      expected: {
        state: "failed",
        message: "The task output did not contain a publish result"
      }
    },
    {
      name: "needs_attention when Manus stops without a result",
      task: {
        status: "stopped",
        events: [statusUpdate("stopped"), assistantMessage("Done?")]
      },
      expected: {
        state: "needs_attention",
        message:
          "Manus stopped without reporting a publish result. Check the task before posting again."
      }
    }
  ])("reports $name", async ({ task, expected }) => {
    fake.setTask(taskId, task);

    const result = await client.callTool({
      name: "get_post_status",
      arguments: { taskId }
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ ...base, ...expected });
    expect(JSON.parse(textOf(result))).toEqual({ ...base, ...expected });
    const listMessages = fake.apiRequests("task.listMessages")[0];
    expect(Object.fromEntries(listMessages?.query ?? [])).toEqual({
      task_id: taskId,
      order: "desc",
      limit: "50"
    });
    expect(
      Object.fromEntries(fake.apiRequests("task.detail")[0]?.query ?? [])
    ).toEqual({ task_id: taskId });
  });

  it("returns the Manus error for an unknown task", async () => {
    const result = await client.callTool({
      name: "get_post_status",
      arguments: { taskId: "task_unknown" }
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("task task_unknown not found");
  });
});

describe("startup", () => {
  it.each([
    { name: "missing", env: {} },
    { name: "empty", env: { MANUS_API_KEY: "" } }
  ])(
    "exits with a clear error when MANUS_API_KEY is $name",
    async ({ env }) => {
      const child = spawn(process.execPath, [entry], {
        env: { ...getDefaultEnvironment(), MANUS_BASE_URL: fake.url, ...env },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

      const [code] = (await once(child, "close")) as [number | null];

      expect(code).not.toBe(0);
      expect(code).not.toBeNull();
      expect(stderr).toContain(
        "Invalid configuration: MANUS_API_KEY is required"
      );
      expect(stdout).toBe("");
      expect(fake.requests).toEqual([]);
    }
  );
});
