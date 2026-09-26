import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { InstagramPublisher } from "./instagram.js";

const postStatusSchema = z.object({
  taskId: z.string(),
  taskUrl: z.string(),
  state: z.enum(["running", "needs_attention", "published", "failed"]),
  postUrl: z.string().optional(),
  message: z.string().optional()
});

export function createServer(publisher: InstagramPublisher): McpServer {
  const server = new McpServer({ name: "instagram", version: "0.2.0" });

  server.registerTool(
    "post_reel",
    {
      title: "Post Instagram Reel",
      description:
        "Upload a local .mp4 and have Manus publish it to Instagram as a Reel with the given caption. Returns immediately with a Manus task; publishing takes a few minutes, so follow up with get_post_status. Each call publishes a new Reel.",
      inputSchema: z.object({
        videoPath: z
          .string()
          .min(1)
          .describe("Absolute path to the .mp4 file, ~/ is allowed"),
        caption: z.string().max(2200).describe("Exact Instagram caption")
      }),
      outputSchema: z.object({ taskId: z.string(), taskUrl: z.string() }),
      annotations: { readOnlyHint: false, idempotentHint: false }
    },
    async ({ videoPath, caption }) => {
      const task = await publisher.postReel(videoPath, caption);
      return {
        content: [
          {
            type: "text",
            text: `Publishing started. Manus task ${task.taskId}: ${task.taskUrl}`
          }
        ],
        structuredContent: task
      };
    }
  );

  server.registerTool(
    "get_post_status",
    {
      title: "Get Instagram post status",
      description:
        "Check a post_reel task. state is running, needs_attention (open taskUrl to resolve in Manus), published (with postUrl), or failed (with message).",
      inputSchema: z.object({
        taskId: z.string().min(1).describe("taskId returned by post_reel")
      }),
      outputSchema: postStatusSchema,
      annotations: { readOnlyHint: true }
    },
    async ({ taskId }) => {
      const status = await publisher.getPostStatus(taskId);
      return {
        content: [{ type: "text", text: JSON.stringify(status) }],
        structuredContent: status
      };
    }
  );

  return server;
}
