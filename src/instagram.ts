import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";
import { z } from "zod";
import type { Connector, ManusClient, TaskEvent } from "./manus.js";

const maxVideoBytes = 512 * 1024 * 1024;

const publishResultSchema = z.object({
  published: z.boolean(),
  post_url: z.string().nullable(),
  error: z.string().nullable()
});

const publishOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["published", "post_url", "error"],
  properties: {
    published: {
      type: "boolean",
      description: "True only if the Reel is live on Instagram"
    },
    post_url: {
      type: ["string", "null"],
      description: "Permalink of the published Reel"
    },
    error: {
      type: ["string", "null"],
      description: "Why publishing failed, or null on success"
    }
  }
};

export type PostState = "running" | "needs_attention" | "published" | "failed";

export interface PostStatus {
  taskId: string;
  taskUrl: string;
  state: PostState;
  postUrl?: string;
  message?: string;
}

export class InstagramPublisher {
  constructor(
    private readonly manus: ManusClient,
    private readonly connector: string
  ) {}

  async postReel(
    videoPath: string,
    caption: string
  ): Promise<{ taskId: string; taskUrl: string }> {
    const path = await validateVideo(videoPath);
    const connector = await this.findConnector();
    const filename = basename(path);
    const fileId = await this.manus.uploadFile(
      filename,
      await openAsBlob(path, { type: "video/mp4" })
    );
    return this.manus.createTask({
      title: `Instagram Reel: ${filename}`,
      prompt: publishPrompt(filename, caption),
      fileId,
      filename,
      connectorId: connector.id,
      outputSchema: publishOutputSchema
    });
  }

  async getPostStatus(taskId: string): Promise<PostStatus> {
    const [task, events] = await Promise.all([
      this.manus.getTask(taskId),
      this.manus.listRecentEvents(taskId)
    ]);
    const base = { taskId: task.id, taskUrl: task.task_url };
    switch (task.status) {
      case "running":
        return { ...base, state: "running" };
      case "waiting":
        return {
          ...base,
          state: "needs_attention",
          message:
            waitingDescription(events) ??
            "Manus is waiting for input. Open the task to respond."
        };
      case "error":
        return {
          ...base,
          state: "failed",
          message: latestError(events) ?? "The Manus task failed."
        };
      case "stopped":
        if (task.has_running_background_jobs === true) {
          return { ...base, state: "running" };
        }
        return { ...base, ...interpretResult(events) };
    }
  }

  private async findConnector(): Promise<Connector> {
    const connectors = await this.manus.listConnectors();
    const wanted = this.connector.toLowerCase();
    const matches = connectors.filter(
      (connector) =>
        connector.id === this.connector ||
        connector.name.toLowerCase() === wanted
    );
    const [match] = matches;
    if (match === undefined) {
      const installed =
        connectors.map((connector) => connector.name).join(", ") || "none";
      throw new Error(
        `No Manus connector matches "${this.connector}". Installed connectors: ${installed}. Add the Instagram connector in Manus under Settings > Connectors, or set MANUS_INSTAGRAM_CONNECTOR to its name or id.`
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `Several Manus connectors match "${this.connector}": ${matches.map((connector) => connector.id).join(", ")}. Set MANUS_INSTAGRAM_CONNECTOR to one of these ids.`
      );
    }
    return match;
  }
}

async function validateVideo(videoPath: string): Promise<string> {
  const path = videoPath.startsWith("~/")
    ? join(homedir(), videoPath.slice(2))
    : videoPath;
  if (!isAbsolute(path)) {
    throw new Error(`videoPath must be an absolute path, got "${videoPath}"`);
  }
  if (extname(path).toLowerCase() !== ".mp4") {
    throw new Error(`videoPath must point to an .mp4 file, got "${path}"`);
  }
  const info = await stat(path).catch(() => undefined);
  if (info?.isFile() !== true) {
    throw new Error(`No video file found at "${path}"`);
  }
  if (info.size === 0) {
    throw new Error(`Video file "${path}" is empty`);
  }
  if (info.size > maxVideoBytes) {
    throw new Error(`Video file "${path}" is larger than Manus's 512 MB limit`);
  }
  return path;
}

function publishPrompt(filename: string, caption: string): string {
  return [
    `Publish the attached video "${filename}" to Instagram as a single Reel using the Instagram connector.`,
    "Use exactly the caption between the <caption> tags, character for character, with no edits, additions, or hashtags of your own.",
    `<caption>\n${caption}\n</caption>`,
    "Publish it exactly once. Do not create, edit, or delete any other Instagram content.",
    "If publishing fails, do not retry with a different video or caption; report the error instead.",
    "When done, report whether the Reel is live and its permalink."
  ].join("\n\n");
}

function waitingDescription(events: TaskEvent[]): string | undefined {
  for (const event of events) {
    if (event.type === "status_update") {
      return event.status_update.status_detail?.waiting_description;
    }
  }
  return undefined;
}

function latestError(events: TaskEvent[]): string | undefined {
  for (const event of events) {
    if (event.type === "error_message") return event.error_message.content;
  }
  return undefined;
}

function interpretResult(
  events: TaskEvent[]
): Pick<PostStatus, "state" | "postUrl" | "message"> {
  const event = events.find((item) => item.type === "structured_output_result");
  if (event === undefined) {
    return {
      state: "needs_attention",
      message:
        "Manus stopped without reporting a publish result. Check the task before posting again."
    };
  }
  const result = event.structured_output_result;
  const value = publishResultSchema.safeParse(result.value);
  if (!result.success || !value.success) {
    return {
      state: "failed",
      message: result.error ?? "Manus returned an unreadable publish result."
    };
  }
  if (!value.data.published) {
    return {
      state: "failed",
      message: value.data.error ?? "Manus reported the Reel was not published."
    };
  }
  return {
    state: "published",
    ...(value.data.post_url === null ? {} : { postUrl: value.data.post_url })
  };
}
