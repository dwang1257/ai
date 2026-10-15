import { z } from "zod";
import type {
  BrowserClient,
  ManusClient,
  StructuredOutput,
  TaskCheck
} from "./manus.js";

export const platforms = [
  "tiktok",
  "instagram",
  "youtube_shorts",
  "x"
] as const;

export type Platform = (typeof platforms)[number];

export type TrendTarget =
  { kind: "niche"; niche: string } | { kind: "creator"; handle: string };

export interface TrendRequest {
  platform: Platform;
  target: TrendTarget;
  count: number;
  days: number;
  useMyBrowser: boolean;
}

export interface TrendTask {
  taskId: string;
  taskUrl: string;
  browser?: BrowserClient;
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

const platformProfileUrls: Record<Platform, (handle: string) => string> = {
  tiktok: (handle) => `https://www.tiktok.com/@${handle}`,
  instagram: (handle) => `https://www.instagram.com/${handle}/reels/`,
  youtube_shorts: (handle) => `https://www.youtube.com/@${handle}/shorts`,
  x: (handle) => `https://x.com/${handle}/media`
};

const handlePattern = /^[A-Za-z0-9._-]{1,30}$/;

export function trendTarget(
  niche: string | undefined,
  creator: string | undefined
): TrendTarget {
  if ((niche === undefined) === (creator === undefined)) {
    throw new Error("Give exactly one of niche or creator.");
  }
  if (niche !== undefined) {
    const trimmed = niche.trim();
    if (trimmed === "") throw new Error("niche must not be empty");
    return { kind: "niche", niche: trimmed };
  }
  const handle = (creator ?? "").trim().replace(/^@/, "");
  if (!handlePattern.test(handle)) {
    throw new Error(
      `creator must be an account handle such as @name, got "${creator ?? ""}"`
    );
  }
  return { kind: "creator", handle };
}

export function targetLabel(target: TrendTarget): string {
  return target.kind === "niche" ? target.niche : `@${target.handle}`;
}

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
  constructor(
    private readonly manus: ManusClient,
    private readonly preferredBrowser?: string
  ) {}

  async start(request: TrendRequest): Promise<TrendTask> {
    const browser = request.useMyBrowser
      ? await this.onlineBrowser(request.platform)
      : undefined;
    const task = await this.manus.createTask({
      title: `Trend research: ${platformLabels[request.platform]} / ${targetLabel(request.target)}`,
      prompt: researchPrompt(request),
      connectorIds: [],
      outputSchema: trendOutputSchema
    });
    return { ...task, ...(browser && { browser }) };
  }

  async check(
    taskId: string,
    browser?: BrowserClient
  ): Promise<TrendTaskStatus> {
    const status = await this.manus.checkTask(taskId);
    if (status.state === "needs_attention") {
      if (status.waitingFor?.type === "needConnectMyBrowser") {
        return this.connectBrowser(status, status.waitingFor.id, browser);
      }
      return {
        taskId: status.taskId,
        taskUrl: status.taskUrl,
        state: "needs_attention",
        message: status.message
      };
    }
    if (status.state !== "finished") return status;
    return {
      taskId: status.taskId,
      taskUrl: status.taskUrl,
      ...interpretResult(status.output)
    };
  }

  private async onlineBrowser(platform: Platform): Promise<BrowserClient> {
    const online = await this.manus.listOnlineBrowsers();
    const names = online.map((client) => `"${client.name}"`).join(", ");
    const preferred = this.preferredBrowser?.toLowerCase();
    if (preferred !== undefined) {
      const match = online.find(
        (client) =>
          client.id.toLowerCase() === preferred ||
          client.name.toLowerCase() === preferred
      );
      if (match !== undefined) return match;
      throw new Error(
        `No online Manus browser matches MANUS_BROWSER "${this.preferredBrowser ?? ""}". Online browsers: ${names || "none"}.`
      );
    }
    const [only, ...others] = online;
    if (only === undefined) {
      throw new Error(
        `No browser is connected to Manus. Install the Manus Browser extension in Chrome, sign in to Manus there, sign in to ${platformLabels[platform]} in that Chrome with an adult account, keep Chrome open, and try again.`
      );
    }
    if (others.length > 0) {
      throw new Error(
        `Several browsers are connected to Manus (${names}). Set MANUS_BROWSER to the name of the one to use.`
      );
    }
    return only;
  }

  private async connectBrowser(
    status: TaskCheck,
    eventId: string,
    browser: BrowserClient | undefined
  ): Promise<TrendTaskStatus> {
    const base = { taskId: status.taskId, taskUrl: status.taskUrl };
    if (browser === undefined) {
      return {
        ...base,
        state: "needs_attention",
        message:
          "Manus asked to use your browser, but this research was started without useMyBrowser. Open the task to pick a browser or skip."
      };
    }
    const online = await this.manus.listOnlineBrowsers();
    if (!online.some((client) => client.id === browser.id)) {
      return {
        ...base,
        state: "needs_attention",
        message: `Manus is waiting for your browser "${browser.name}", which is offline. Open Chrome with the Manus Browser extension signed in, then check the status again.`
      };
    }
    if (!(await this.manus.selectBrowser(status.taskId, eventId, browser.id))) {
      return {
        ...base,
        state: "needs_attention",
        message: `Manus did not accept your browser "${browser.name}". Open the task to pick it there.`
      };
    }
    return { ...base, state: "running" };
  }
}

function researchPrompt(request: TrendRequest): string {
  const label = platformLabels[request.platform];
  const since = new Date(Date.now() - request.days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return [
    ...targetInstructions(request, label, since),
    `Return the canonical, directly openable URL of each post in the form ${platformUrlFormats[request.platform]}. Do not return search, profile, or embed URLs.`,
    "Apply this safety filter strictly. Only include creators who are clearly adults, such as established accounts with no school, teen, or age signals; if a creator's age is uncertain, skip them. Skip anything with nudity, sexual acts, or explicit content. Skip private or deleted posts. Skipping is always preferred over including something uncertain.",
    ...accessInstructions(request, label),
    "For each video describe: the hook (what happens in the first 1-3 seconds and why it stops the scroll); the structure (shot sequence, transitions, length in seconds, pacing); the audio (sound or trending audio name, voiceover or music); the exact on-screen text overlays; the caption style (tone, length, emoji and CTA pattern); the hashtags; and a recipe, a short practical note for shooting an original version (setting, outfit category, camera angle, props, edit style).",
    "Report views, likes, and posting dates only as shown on the post. Use null for anything unknown and do not guess numbers.",
    "If you find fewer qualifying videos than requested, return the ones you found and explain why in error."
  ].join("\n\n");
}

function accessInstructions(request: TrendRequest, label: string): string[] {
  if (!request.useMyBrowser) {
    return [
      "This is research only. Do not like, follow, comment on, download, or post anything. If a login wall blocks progress, use another public route such as web search or the platform's public pages. If nothing works, report that in error."
    ];
  }
  return [
    `Use my browser for all ${label} browsing. I am signed in there with an adult account, so age-restricted (18+) profiles and posts that are hidden from logged-out visitors are visible. An 18+ restriction only limits who can view an account; still apply the safety filter to every video.`,
    "This is research only. Do not like, follow, comment on, save, download, or post anything, and do not sign in, sign out, or change any account or setting. If my browser cannot show the posts, report that in error."
  ];
}

function targetInstructions(
  request: TrendRequest,
  label: string,
  since: string
): string[] {
  const window = `within the last ${request.days} days (on or after ${since})`;
  if (request.target.kind === "niche") {
    return [
      `Find the top ${request.count} public short-form videos on ${label} in the niche between the <niche> tags, posted ${window}.`,
      `<niche>\n${request.target.niche}\n</niche>`,
      "Rank them by real engagement: views first, then likes. Include at most one video per creator."
    ];
  }
  const { handle } = request.target;
  return [
    `Find the top ${request.count} public short-form videos on ${label} posted by the account @${handle} ${window}.`,
    `The account's videos are listed at ${platformProfileUrls[request.platform](handle)}.`,
    "Only include videos this account posted itself, not reposts or videos of it posted by other accounts. If the account does not exist or is private, report that in error.",
    "Rank them by real engagement: views first, then likes."
  ];
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
  if (output.success === false || !value.success) {
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
