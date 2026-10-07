import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { audioModes, imageModels, resolutions } from "./animate.js";
import type { AnimationStatus, Animator } from "./animate.js";
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

const animationStatusSchema = z.object({
  jobId: z.string(),
  state: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  progress: z.number(),
  phase: z.string().optional(),
  message: z.string().optional(),
  outputs: z.array(z.string()).optional(),
  error: z.string().optional()
});

const seconds = z.number().min(0).max(3600);

export function createServer(
  publisher: InstagramPublisher,
  researcher: TrendResearcher,
  animator: Animator
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

  server.registerTool(
    "animate_video",
    {
      title: "Animate a character with Maestro",
      description:
        "Run Maestro's Viggle Animate recipe on the Maestro PC: the control video supplies the motion and the character replaces the person in it. Give exactly one of editedFramePath (a frame of the control video already edited to show the character), characterImagePath (a character image; Maestro prepares the replacement frame with Flux 2 Klein), or character (a saved Maestro character name or id, see list_maestro_characters). Uploads the files, queues one GPU job, and returns immediately; generation takes several minutes, so follow up with get_animation_status. Each call queues a new job, so do not retry blindly. Only use footage and likenesses you have the rights and consent to use; trend research clips are refused.",
      inputSchema: z.object({
        controlVideoPath: z
          .string()
          .min(1)
          .describe(
            "Absolute path to the control video whose motion drives the result, ~/ is allowed"
          ),
        editedFramePath: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Absolute path to an edited frame image of the control video showing the character"
          ),
        characterImagePath: z
          .string()
          .min(1)
          .optional()
          .describe("Absolute path to a character image"),
        character: z
          .string()
          .min(1)
          .optional()
          .describe("Saved Maestro character name or id"),
        audio: z
          .enum(audioModes)
          .default("none")
          .describe(
            "none (silent), control (keep the control video's soundtrack), or custom (use audioPath)"
          ),
        audioPath: z
          .string()
          .min(1)
          .optional()
          .describe("Absolute path to the soundtrack when audio is custom"),
        resolution: z
          .enum(resolutions)
          .optional()
          .describe("Output resolution, defaults to MAESTRO_RESOLUTION"),
        seed: z
          .number()
          .int()
          .min(-1)
          .optional()
          .describe("Seed, -1 or omitted for random"),
        trimStart: seconds
          .optional()
          .describe("Start of the control video section to use, in seconds"),
        trimEnd: seconds
          .optional()
          .describe("End of the control video section to use, in seconds"),
        frameSeconds: seconds
          .optional()
          .describe(
            "Time in the control video of the frame the character replaces, in seconds"
          ),
        imageModel: z
          .enum(imageModels)
          .optional()
          .describe("Flux 2 Klein model that prepares the character frame")
      }),
      outputSchema: z.object({
        jobId: z.string(),
        queued: z.boolean(),
        maestroUrl: z.string(),
        controlVideoSeconds: z.number().optional()
      }),
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (request) => {
      const job = await animator.start(request);
      return {
        content: [
          {
            type: "text",
            text: `Animation queued on Maestro (${job.maestroUrl}) as job ${job.jobId}. Check progress with get_animation_status.`
          }
        ],
        structuredContent: job
      };
    }
  );

  server.registerTool(
    "get_animation_status",
    {
      title: "Get Maestro animation status",
      description:
        "Check an animate_video job. state is queued (waiting for the GPU), running (with progress 0 to 100 and phase), completed (outputs lists the downloaded local video paths), failed (with error), or cancelled. The first call after completion downloads the result.",
      inputSchema: z.object({
        jobId: z.string().min(1).describe("jobId returned by animate_video")
      }),
      outputSchema: animationStatusSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ jobId }) => {
      const status = await animator.getStatus(jobId);
      return {
        content: [{ type: "text", text: describeAnimation(status) }],
        structuredContent: status
      };
    }
  );

  server.registerTool(
    "cancel_animation",
    {
      title: "Cancel a Maestro animation",
      description: "Cancel a queued or running animate_video job.",
      inputSchema: z.object({
        jobId: z.string().min(1).describe("jobId returned by animate_video")
      }),
      outputSchema: animationStatusSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ jobId }) => {
      const status = await animator.cancel(jobId);
      return {
        content: [{ type: "text", text: describeAnimation(status) }],
        structuredContent: status
      };
    }
  );

  server.registerTool(
    "list_maestro_characters",
    {
      title: "List saved Maestro characters",
      description:
        "List the characters saved in Maestro, for the character input of animate_video.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        characters: z.array(z.object({ id: z.string(), name: z.string() }))
      }),
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async () => {
      const characters = await animator.listCharacters();
      return {
        content: [
          {
            type: "text",
            text: characters.length
              ? characters.map((c) => `${c.name} (${c.id})`).join("\n")
              : "No saved characters in Maestro."
          }
        ],
        structuredContent: { characters }
      };
    }
  );

  return server;
}

function describeAnimation(status: AnimationStatus): string {
  switch (status.state) {
    case "completed":
      return `Animation ${status.jobId} completed:\n${(status.outputs ?? []).join("\n")}`;
    case "failed":
      return `Animation ${status.jobId} failed: ${status.error ?? "unknown error"}`;
    case "cancelled":
      return `Animation ${status.jobId} was cancelled.`;
    default:
      return `Animation ${status.jobId} is ${status.state}, ${status.progress}%${status.phase ? ` (${status.phase})` : ""}${status.message ? `: ${status.message}` : ""}`;
  }
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
