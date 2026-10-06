import { z } from "zod";
import type { ManusClient, StructuredOutput } from "./manus.js";

export const platforms = [
  "tiktok",
  "instagram",
  "youtube_shorts",
  "x"
] as const;

export type Platform = (typeof platforms)[number];

export interface TrendRequest {
  platform: Platform;
  niche: string;
  count: number;
  days: number;
}

export interface TrendVideo {
  url: string;
  creator: string;
  postedAt: string | null;
  views: number | null;
  likes: number | null;
  hook: string;
  structure: string;
  audio: string;
  onScreenText: string;
  captionStyle: string;
  hashtags: string[];
  recipe: string;
}

export type TrendTaskResult =
  | { state: "running" }
  | { state: "needs_attention"; message: string }
  | { state: "failed"; message: string }
  | { state: "done"; videos: TrendVideo[] };

export type TrendTaskStatus = {
  taskId: string;
  taskUrl: string;
} & TrendTaskResult;

export const platformLabels: Record<Platform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram Reels",
  youtube_shorts: "YouTube Shorts",
  x: "X"
};

const platformUrlFormats: Record<Platform, string> = {
  tiktok: "https://www.tiktok.com/@<user>/video/<id>",
  instagram: "https://www.instagram.com/reel/<code>/",
  youtube_shorts: "https://www.youtube.com/shorts/<id>",
  x: "https://x.com/<user>/status/<id>"
};

const trendResultSchema = z.object({
  videos: z.array(
    z.object({
      url: z.string(),
      creator: z.string(),
      posted_at: z.string().nullable(),
      views: z.number().nullable(),
      likes: z.number().nullable(),
      hook: z.string(),
      structure: z.string(),
      audio: z.string(),
      on_screen_text: z.string(),
      caption_style: z.string(),
      hashtags: z.array(z.string()),
      recipe: z.string()
    })
  ),
  error: z.string().nullable()
});

const trendOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["videos", "error"],
  properties: {
    videos: {
      type: "array",
      description: "Qualifying videos, ranked by views then likes",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "url",
          "creator",
          "posted_at",
          "views",
          "likes",
          "hook",
          "structure",
          "audio",
          "on_screen_text",
          "caption_style",
          "hashtags",
          "recipe"
        ],
        properties: {
          url: {
            type: "string",
            description: "Canonical, directly openable URL of the post"
          },
          creator: {
            type: "string",
            description: "Creator handle"
          },
          posted_at: {
            type: ["string", "null"],
            description: "Posting date in ISO 8601, or null if unknown"
          },
          views: {
            type: ["integer", "null"],
            description: "View count as shown on the post, or null if unknown"
          },
          likes: {
            type: ["integer", "null"],
            description: "Like count as shown on the post, or null if unknown"
          },
          hook: {
            type: "string",
            description:
              "What happens in the first 1-3 seconds and why it stops the scroll"
          },
          structure: {
            type: "string",
            description:
              "Shot sequence, transitions, length in seconds, and pacing"
          },
          audio: {
            type: "string",
            description:
              "Sound or trending audio name, and whether it uses voiceover or music"
          },
          on_screen_text: {
            type: "string",
            description:
              "Exact text overlays, or an empty string if there are none"
          },
          caption_style: {
            type: "string",
            description: "Caption tone, length, and emoji or CTA pattern"
          },
          hashtags: {
            type: "array",
            items: { type: "string" },
            description: "Hashtags used on the post"
          },
          recipe: {
            type: "string",
            description:
              "Practical note for shooting an original version: setting, outfit category, camera angle, props, and edit style"
          }
        }
      }
    },
    error: {
      type: ["string", "null"],
      description:
        "Why the research found fewer videos than requested or none at all, or null if it found enough"
    }
  }
};

export class TrendScout {
  constructor(private readonly manus: ManusClient) {}

  start(request: TrendRequest): Promise<{ taskId: string; taskUrl: string }> {
    return this.manus.createTask({
      title: `Trend research: ${platformLabels[request.platform]} / ${request.niche}`,
      prompt: researchPrompt(request),
      connectorIds: [],
      outputSchema: trendOutputSchema
    });
  }

  async check(taskId: string): Promise<TrendTaskStatus> {
    const status = await this.manus.checkTask(taskId);
    if (status.state !== "finished") return status;
    return {
      taskId: status.taskId,
      taskUrl: status.taskUrl,
      ...interpretResult(status.output)
    };
  }
}

function researchPrompt(request: TrendRequest): string {
  const label = platformLabels[request.platform];
  const since = new Date(Date.now() - request.days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return [
    `Find the top ${request.count} public short-form videos on ${label} in the niche between the <niche> tags, posted within the last ${request.days} days (on or after ${since}).`,
    `<niche>\n${request.niche}\n</niche>`,
    "Rank them by real engagement: views first, then likes. Include at most one video per creator.",
    `Return the canonical, directly openable URL of each post in the form ${platformUrlFormats[request.platform]}. Do not return search, profile, or embed URLs.`,
    "Apply this safety filter strictly. Only include creators who are clearly adults, such as established accounts with no school, teen, or age signals; if a creator's age is uncertain, skip them. Skip anything with nudity, sexual acts, or explicit content. Skip private or deleted posts. Skipping is always preferred over including something uncertain.",
    "This is research only. Do not like, follow, comment on, download, or post anything, and do not log in or create accounts. If a login wall blocks progress, use another public route such as web search or the platform's public pages. If nothing works, report that in error.",
    "For each video describe: the hook (what happens in the first 1-3 seconds and why it stops the scroll); the structure (shot sequence, transitions, length in seconds, pacing); the audio (sound or trending audio name, voiceover or music); the exact on-screen text overlays; the caption style (tone, length, emoji and CTA pattern); the hashtags; and a recipe, a short practical note for shooting an original version (setting, outfit category, camera angle, props, edit style).",
    "Report views, likes, and posting dates only as shown on the post. Use null for anything unknown and do not guess numbers.",
    "If you find fewer qualifying videos than requested, return the ones you found and explain why in error."
  ].join("\n\n");
}

function interpretResult(
  output: StructuredOutput | undefined
): TrendTaskResult {
  if (output === undefined) {
    return {
      state: "needs_attention",
      message:
        "Manus stopped without reporting research results. Open the task to check what happened."
    };
  }
  const value = trendResultSchema.safeParse(output.value);
  if (!output.success || !value.success) {
    return {
      state: "failed",
      message: output.error ?? "Manus returned unreadable research results."
    };
  }
  if (value.data.videos.length === 0) {
    return {
      state: "failed",
      message: value.data.error ?? "Manus found no videos matching the request."
    };
  }
  return {
    state: "done",
    videos: value.data.videos.map((video) => ({
      url: video.url,
      creator: video.creator,
      postedAt: video.posted_at,
      views: video.views,
      likes: video.likes,
      hook: video.hook,
      structure: video.structure,
      audio: video.audio,
      onScreenText: video.on_screen_text,
      captionStyle: video.caption_style,
      hashtags: video.hashtags,
      recipe: video.recipe
    }))
  };
}
