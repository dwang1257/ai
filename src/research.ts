import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { platformLabels, platforms } from "./trends.js";
import type {
  Platform,
  TrendRequest,
  TrendScout,
  TrendVideo
} from "./trends.js";
import { downloadVideo } from "./ytdlp.js";

const requestFile = "request.json";
const manifestFile = "manifest.json";
const readmeFile = "README.md";

const runRequestSchema = z.object({
  taskId: z.string(),
  taskUrl: z.string(),
  platform: z.enum(platforms),
  niche: z.string(),
  count: z.number(),
  days: z.number(),
  createdAt: z.string()
});

const researchVideoSchema = z.object({
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
  platform: z.enum(platforms),
  localPath: z.string().exactOptional(),
  downloadError: z.string().exactOptional()
});

const manifestSchema = runRequestSchema.extend({
  completedAt: z.string(),
  videos: z.array(researchVideoSchema)
});

type RunRequest = z.infer<typeof runRequestSchema>;

interface Run {
  dir: string;
  request: RunRequest;
}

export type ResearchState =
  "running" | "needs_attention" | "downloading" | "complete" | "failed";

export interface ResearchVideo extends TrendVideo {
  platform: Platform;
  localPath?: string;
  downloadError?: string;
}

export interface ResearchStatus {
  taskId: string;
  taskUrl: string;
  state: ResearchState;
  message?: string;
  outputDir?: string;
  videos?: ResearchVideo[];
}

export interface ResearchOptions {
  researchDir: string;
  ytdlpPath: string;
  cookiesFromBrowser?: string;
}

export class TrendResearcher {
  private readonly downloads = new Map<string, Promise<void>>();
  private readonly failures = new Map<string, string>();

  constructor(
    private readonly scout: TrendScout,
    private readonly options: ResearchOptions
  ) {}

  async start(
    request: TrendRequest
  ): Promise<{ taskId: string; taskUrl: string; outputDir: string }> {
    const niche = request.niche.trim();
    if (niche === "") throw new Error("niche must not be empty");
    const { taskId, taskUrl } = await this.scout.start({ ...request, niche });
    const createdAt = new Date();
    const outputDir = join(
      this.options.researchDir,
      `${localDate(createdAt)}-${request.platform}-${slug(niche, 40) || "trends"}-${taskId}`
    );
    try {
      if (!isSafeTaskId(taskId)) {
        throw new Error("the task id is not usable as a folder name");
      }
      await mkdir(outputDir, { recursive: true });
      const run: RunRequest = {
        taskId,
        taskUrl,
        platform: request.platform,
        niche,
        count: request.count,
        days: request.days,
        createdAt: createdAt.toISOString()
      };
      await writeJsonAtomic(join(outputDir, requestFile), run);
    } catch (error) {
      throw new Error(
        `Manus task ${taskId} started (${taskUrl}) but its research folder could not be created: ${errorMessage(error)}`,
        { cause: error }
      );
    }
    return { taskId, taskUrl, outputDir };
  }

  async getStatus(taskId: string): Promise<ResearchStatus> {
    const run = await this.findRun(taskId);
    const outputDir = run.dir;
    const manifest = await readJson(
      join(outputDir, manifestFile),
      manifestSchema
    );
    if (manifest !== undefined) {
      return {
        taskId,
        taskUrl: manifest.taskUrl,
        state: "complete",
        outputDir,
        videos: manifest.videos
      };
    }
    const failure = this.failures.get(taskId);
    if (failure !== undefined) {
      this.failures.delete(taskId);
      return {
        taskId,
        taskUrl: run.request.taskUrl,
        state: "failed",
        message: `Saving the research failed: ${failure}. Check the status again to retry the download.`,
        outputDir
      };
    }
    if (this.downloads.has(taskId)) {
      return downloading(taskId, run.request.taskUrl, outputDir);
    }
    const status = await this.scout.check(taskId);
    const base = { taskId, taskUrl: status.taskUrl, outputDir };
    switch (status.state) {
      case "running":
        return { ...base, state: "running" };
      case "needs_attention":
        return { ...base, state: "needs_attention", message: status.message };
      case "failed":
        return { ...base, state: "failed", message: status.message };
      case "done":
        this.startDownload(run, status.videos);
        return downloading(taskId, status.taskUrl, outputDir, status.videos);
    }
  }

  private startDownload(run: Run, videos: TrendVideo[]): void {
    const { taskId } = run.request;
    if (this.downloads.has(taskId)) return;
    const job = this.saveRun(run, videos)
      .catch((error: unknown) => {
        this.failures.set(taskId, errorMessage(error));
      })
      .finally(() => {
        this.downloads.delete(taskId);
      });
    this.downloads.set(taskId, job);
  }

  private async saveRun(run: Run, videos: TrendVideo[]): Promise<void> {
    const results: ResearchVideo[] = [];
    for (const [index, video] of videos.entries()) {
      results.push(await this.saveVideo(run, index, video));
    }
    const manifest = {
      ...run.request,
      completedAt: new Date().toISOString(),
      videos: results
    };
    await writeFile(join(run.dir, readmeFile), readme(run.request, results));
    await writeJsonAtomic(join(run.dir, manifestFile), manifest);
  }

  private async saveVideo(
    run: Run,
    index: number,
    video: TrendVideo
  ): Promise<ResearchVideo> {
    const number = String(index + 1).padStart(2, "0");
    const name = slug(video.creator, 30) || "video";
    const outputBase = join(run.dir, `${number}-${name}`);
    const result = { ...video, platform: run.request.platform };
    const existing = `${outputBase}.mp4`;
    if (await isFile(existing)) return { ...result, localPath: existing };
    try {
      const localPath = await downloadVideo(
        video.url,
        outputBase,
        this.options
      );
      return { ...result, localPath };
    } catch (error) {
      return { ...result, downloadError: errorMessage(error) };
    }
  }

  private async findRun(taskId: string): Promise<Run> {
    if (isSafeTaskId(taskId)) {
      const suffix = `-${taskId}`;
      for (const entry of await listDir(this.options.researchDir)) {
        if (!entry.isDirectory() || !entry.name.endsWith(suffix)) continue;
        const dir = join(this.options.researchDir, entry.name);
        const request = await readJson(
          join(dir, requestFile),
          runRequestSchema
        );
        if (request?.taskId === taskId) return { dir, request };
      }
    }
    throw new Error(
      `Unknown taskId "${taskId}". No trend research was started for it in "${this.options.researchDir}".`
    );
  }
}

function downloading(
  taskId: string,
  taskUrl: string,
  outputDir: string,
  videos?: TrendVideo[]
): ResearchStatus {
  const count =
    videos === undefined
      ? "the videos"
      : `${videos.length} ${videos.length === 1 ? "video" : "videos"}`;
  return {
    taskId,
    taskUrl,
    state: "downloading",
    message: `Manus finished. Downloading ${count} into "${outputDir}". Check the status again shortly.`,
    outputDir
  };
}

function readme(request: RunRequest, videos: ResearchVideo[]): string {
  const created = new Date(request.createdAt);
  const from = new Date(created.getTime() - request.days * 86_400_000);
  const downloaded = videos.filter((video) => video.localPath !== undefined);
  const lines = [
    `# ${platformLabels[request.platform]} / ${request.niche} trend research`,
    "",
    `Window: last ${request.days} days (${localDate(from)} to ${localDate(created)}).`,
    `Manus task: ${request.taskUrl}`,
    `Videos: ${videos.length} found of ${request.count} requested, ${downloaded.length} downloaded.`
  ];
  for (const [index, video] of videos.entries()) {
    lines.push("", ...videoSection(index, video));
  }
  return `${lines.join("\n")}\n`;
}

function videoSection(index: number, video: ResearchVideo): string[] {
  const number = String(index + 1).padStart(2, "0");
  const creator = video.creator.replace(/^@+/, "");
  const file =
    video.localPath === undefined
      ? `- Download failed: ${video.downloadError ?? "unknown error"}`
      : `- File: [${basename(video.localPath)}](${encodeURI(basename(video.localPath))})`;
  const facts = [
    `- Source: ${video.url}`,
    file,
    ...(video.postedAt === null ? [] : [`- Posted: ${video.postedAt}`]),
    ...(video.views === null ? [] : [`- Views: ${formatCount(video.views)}`]),
    ...(video.likes === null ? [] : [`- Likes: ${formatCount(video.likes)}`])
  ];
  const hashtags = video.hashtags
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
    .join(" ");
  const notes: [string, string][] = [
    ["Hook", video.hook],
    ["Structure", video.structure],
    ["Audio", video.audio],
    ["On-screen text", video.onScreenText],
    ["Caption style", video.captionStyle],
    ["Hashtags", hashtags || "none"],
    ["Recipe", video.recipe]
  ];
  return [
    `## ${number}. @${creator}`,
    "",
    ...facts,
    ...notes.flatMap(([label, text]) => ["", `**${label}:** ${text}`])
  ];
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function slug(text: string, maxLength: number): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, maxLength)
    .replace(/-+$/, "");
}

function localDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function isSafeTaskId(taskId: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(taskId) && !/^\.+$/.test(taskId);
}

async function listDir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

async function isFile(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => undefined);
  return info?.isFile() === true && info.size > 0;
}

async function readJson<T>(
  path: string,
  schema: z.ZodType<T>
): Promise<T | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
  const parsed = schema.safeParse(parseJson(text));
  if (!parsed.success) {
    throw new Error(`"${path}" is not a valid research file.`);
  }
  return parsed.data;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, path);
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error && (error as { code?: unknown }).code === "ENOENT"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
