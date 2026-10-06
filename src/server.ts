import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { InstagramPublisher } from "./instagram.js";
import type { ResearchStatus, TrendResearcher } from "./research.js";
import { platforms } from "./trends.js";

const postStatusSchema = z.object({
  taskId: z.string(),
  taskUrl: z.string(),
  state: z.enum(["running", "needs_attention", "published", "failed"]),
  postUrl: z.string().optional(),
  message: z.string().optional()
});

const researchVideoSchema = z.object({
  platform: z.enum(platforms),
  url: z.string(),
  creator: z.string(),
  postedAt: z.string().nullable(),
  views: z.number().nullable(),
  likes: z.number().nullable(),
  hook: z.string(),
  structure: z.string(),
  audio: z.string(),
  onScreenText: z.string(),
  captionStyle: z.string(),
  hashtags: z.array(z.string()),
  recipe: z.string(),
  localPath: z.string().optional(),
  downloadError: z.string().optional()
});

const researchStatusSchema = z.object({
  taskId: z.string(),
  taskUrl: z.string(),
  state: z.enum([
    "running",
    "needs_attention",
    "downloading",
    "complete",
    "failed"
  ]),
  message: z.string().optional(),
  outputDir: z.string().optional(),
  videos: z.array(researchVideoSchema).optional()
});

export function createServer(
  publisher: InstagramPublisher,
  researcher: TrendResearcher
): McpServer {
  const server = new McpServer({ name: "instagram", version: "0.3.0" });

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

  server.registerTool(
    "research_trends",
    {
      title: "Research trending Reel formats",
      description:
        "Start a billed Manus task that finds the top public short-form videos for one platform and niche from the last few days, restricted to adult creators and non-explicit content, and writes a format breakdown per video (hook, structure, audio, on-screen text, caption style, hashtags, recipe) for shooting original content in that format. Returns immediately; follow up with get_research_status. The videos are saved locally as reference only and are never reposted. Each call starts a new billed task, so do not retry blindly.",
      inputSchema: z.object({
        platform: z
          .enum(platforms)
          .describe(
            "tiktok (TikTok), instagram (Instagram Reels), youtube_shorts (YouTube Shorts), or x (X video posts)"
          ),
        niche: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .describe(
            'Niche to search, for example "gym", "beach", or "fashion"'
          ),
        count: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(10)
          .describe("How many top videos to research"),
        days: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(7)
          .describe("Only consider videos posted within this many days")
      }),
      outputSchema: z.object({
        taskId: z.string(),
        taskUrl: z.string(),
        outputDir: z.string()
      }),
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (request) => {
      const task = await researcher.start(request);
      return {
        content: [
          {
            type: "text",
            text: `Research started. Manus task ${task.taskId}: ${task.taskUrl}\nReference clips will be saved to ${task.outputDir}`
          }
        ],
        structuredContent: task
      };
    }
  );

  server.registerTool(
    "get_research_status",
    {
      title: "Get trend research status",
      description:
        "Check a research_trends task. state is running (Manus is still researching), needs_attention (open taskUrl to resolve it in Manus, for example a login wall), downloading (Manus finished and the reference clips are downloading; call again shortly), complete (outputDir and videos with localPath or downloadError plus the format breakdown), or failed (with message). The first call after Manus finishes starts the local download.",
      inputSchema: z.object({
        taskId: z.string().min(1).describe("taskId returned by research_trends")
      }),
      outputSchema: researchStatusSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ taskId }) => {
      const status = await researcher.getStatus(taskId);
      return {
        content: [{ type: "text", text: describeResearch(status) }],
        structuredContent: status
      };
    }
  );

  return server;
}

function describeResearch(status: ResearchStatus): string {
  if (status.state !== "complete") {
    return JSON.stringify(status);
  }
  const videos = status.videos ?? [];
  const saved = videos.filter((video) => video.localPath).length;
  const lines = videos.map((video, index) =>
    [
      `${index + 1}. ${video.creator}: ${video.localPath ?? `download failed (${video.downloadError ?? "unknown error"}) ${video.url}`}`,
      `   Hook: ${video.hook}`
    ].join("\n")
  );
  return [
    `Research complete: ${saved} of ${videos.length} videos saved to ${status.outputDir ?? "the research folder"}`,
    ...lines,
    "Full breakdowns are in README.md and manifest.json in that folder."
  ].join("\n");
}
