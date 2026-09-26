import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ManusClient, ManusError } from "../src/manus.js";
import { FakeManus } from "./fake-manus.js";

let fake: FakeManus;
let manus: ManusClient;

beforeAll(async () => {
  fake = await FakeManus.start();
  manus = new ManusClient(fake.apiKey, fake.url);
});

afterAll(() => fake.close());

beforeEach(() => {
  fake.reset();
});

async function manusError(promise: Promise<unknown>): Promise<ManusError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(ManusError);
  return error as ManusError;
}

describe("ManusClient", () => {
  it("reports a non-JSON gateway failure as http_error", async () => {
    fake.respondWith(
      "connector.list",
      502,
      "<html><body>Bad Gateway</body></html>"
    );

    const error = await manusError(manus.listConnectors());

    expect(error.code).toBe("http_error");
    expect(error.status).toBe(502);
    expect(error.message).toBe("Manus connector.list returned HTTP 502");
  });

  it("reports a response that does not match the documented shape", async () => {
    fake.respondWith("task.detail", 200, {
      ok: true,
      request_id: "req_1",
      task: { id: "task_1", status: "paused", task_url: "https://manus.im" }
    });

    const error = await manusError(manus.getTask("task_1"));

    expect(error.code).toBe("unexpected_response");
    expect(error.message).toContain("status");
  });

  it("surfaces authentication failures from the envelope", async () => {
    const unauthenticated = new ManusClient("wrong-key", fake.url);

    const error = await manusError(unauthenticated.listConnectors());

    expect(error.code).toBe("unauthenticated");
    expect(error.status).toBe(401);
  });

  it("reports a rejected upload PUT as upload_failed", async () => {
    fake.respondWith("file.upload", 200, {
      ok: true,
      request_id: "req_1",
      file: { id: "file-1", filename: "clip.mp4", status: "pending" },
      upload_url: `${fake.url}/upload/expired`
    });

    const error = await manusError(
      manus.uploadFile("clip.mp4", new Blob(["video"], { type: "video/mp4" }))
    );

    expect(error.code).toBe("upload_failed");
    expect(error.status).toBe(403);
  });

  it("keeps only the event types it understands, newest first", async () => {
    fake.setTask("task_1", {
      status: "stopped",
      events: [
        { type: "user_message", user_message: { content: "Post it" } },
        { type: "status_update", status_update: { agent_status: "running" } },
        { type: "assistant_message", assistant_message: { content: "Done" } },
        { type: "status_update", status_update: { agent_status: "stopped" } }
      ]
    });

    const events = await manus.listRecentEvents("task_1");

    expect(events).toEqual([
      { type: "status_update", status_update: { agent_status: "stopped" } },
      { type: "status_update", status_update: { agent_status: "running" } }
    ]);
  });
});
