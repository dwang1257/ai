import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, rmSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { z } from "zod";
import {
  createAnimator,
  imageExtensions,
  maxUploadBytes,
  videoExtensions
} from "./animate.js";
import type { AudioMode } from "./animate.js";
import { CaptionWriter } from "./caption.js";
import { loadConfig } from "./config.js";
import { InstagramPublisher } from "./instagram.js";
import { MaestroError } from "./maestro.js";
import { ManusClient } from "./manus.js";
import { page } from "./ui-page.js";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const run = promisify(execFile);
const config = loadConfig();
const publisher = new InstagramPublisher(
  new ManusClient(config.apiKey),
  config.instagramConnector
);
const captionWriter =
  config.anthropicApiKey &&
  new CaptionWriter(new Anthropic({ apiKey: config.anthropicApiKey }));
const animator = createAnimator(config);
const host = "127.0.0.1";
const allowedHosts = new Set([
  `${host}:${config.uiPort}`,
  `localhost:${config.uiPort}`
]);
const allowedOrigins = new Set(
  [...allowedHosts].map((allowed) => `http://${allowed}`)
);

const postSchema = z.object({
  videoPath: z.string().min(1, { error: "Enter the path to an .mp4 file" }),
  caption: z
    .string()
    .max(2200, { error: "Caption must be 2200 characters or fewer" })
});

const animateSchema = z.object({
  controlVideoPath: z.string().min(1, { error: "Add a template video" }),
  characterImagePath: z.string().min(1, { error: "Add a template image" }),
  keepAudio: z.boolean({ error: "keepAudio must be true or false" })
});

const uploadKinds = {
  video: { label: "template video", extensions: videoExtensions },
  image: { label: "template image", extensions: imageExtensions }
};

const mediaTypes: Partial<Record<string, string>> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

const silentNote =
  "The template video has no audio track, so the result will be silent.";

let uploadDir: Promise<string> | undefined;
let submitting = false;

function stagingDir(): Promise<string> {
  uploadDir ??= mkdtemp(join(tmpdir(), "maestro-ui-"))
    .then((dir) => realpath(dir))
    .then((dir) => {
      process.once("exit", () => rmSync(dir, { recursive: true, force: true }));
      return dir;
    })
    .catch((error: unknown) => {
      uploadDir = undefined;
      throw error;
    });
  return uploadDir;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function contentType(req: IncomingMessage): string | undefined {
  return req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
}

function requireId(url: URL): string {
  const id = url.searchParams.get("id");
  if (!id) throw new HttpError(400, "Missing id");
  return id;
}

function isInside(dir: string, path: string): boolean {
  const inside = relative(dir, path);
  return inside !== "" && inside.split(sep)[0] !== ".." && !isAbsolute(inside);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function postReel(req: IncomingMessage, res: ServerResponse) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
    send(res, 415, { error: "Expected application/json" });
    return;
  }
  const input = postSchema.safeParse(await readJson(req).catch(() => null));
  if (!input.success) {
    send(res, 400, {
      error: input.error.issues.map((issue) => issue.message).join("; ")
    });
    return;
  }
  let caption = input.data.caption;
  if (!caption.trim()) {
    if (!captionWriter) {
      send(res, 400, {
        error:
          "Enter a caption, or set ANTHROPIC_API_KEY in .env to write one automatically"
      });
      return;
    }
    console.error(`Writing caption for ${input.data.videoPath}`);
    caption = await captionWriter.write(input.data.videoPath);
  }
  console.error(`Posting ${input.data.videoPath}`);
  const task = await publisher.postReel(input.data.videoPath, caption);
  console.error(`Started Manus task ${task.taskId}`);
  send(res, 200, { ...task, caption });
}

async function upload(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (contentType(req) !== "application/octet-stream") {
    throw new HttpError(415, "Expected application/octet-stream");
  }
  const kind = url.searchParams.get("kind");
  if (kind !== "video" && kind !== "image") {
    throw new HttpError(400, 'kind must be "video" or "image"');
  }
  const { label, extensions } = uploadKinds[kind];
  const name = basename(
    (url.searchParams.get("name") ?? "").replace(/\\/g, "/")
  );
  const extension = extname(name).toLowerCase();
  if (!extensions.includes(extension)) {
    throw new HttpError(
      400,
      `The ${label} must be a ${extensions.join(", ")} file, got "${name}"`
    );
  }
  const tooLarge = new HttpError(
    413,
    `"${name}" is larger than Maestro's 500 MB upload limit`
  );
  if (Number(req.headers["content-length"]) > maxUploadBytes) {
    res.setHeader("connection", "close");
    throw tooLarge;
  }
  const dir = join(await stagingDir(), randomUUID());
  await mkdir(dir);
  const stem =
    basename(name, extname(name))
      .replace(/[^\p{L}\p{N}_-]+/gu, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 100) || kind;
  const path = join(dir, `${stem}${extension}`);
  let size = 0;
  try {
    await pipeline(
      req,
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          size += chunk.length;
          if (size > maxUploadBytes) throw tooLarge;
          yield chunk;
        }
      },
      createWriteStream(path, { flags: "wx" })
    );
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    if (error === tooLarge) {
      res.setHeader("connection", "close");
    } else {
      console.error(
        `Upload of "${name}" did not finish (${errorMessage(error)}); removed the partial file`
      );
    }
    throw error;
  }
  if (size === 0) {
    await rm(dir, { recursive: true, force: true });
    throw new HttpError(400, `"${name}" is empty`);
  }
  console.error(`Staged ${label} "${name}" (${size} bytes) at ${path}`);
  send(res, 200, { path, name, size });
}

async function stagedFile(path: string, label: string): Promise<string> {
  const dir = uploadDir === undefined ? undefined : await uploadDir;
  const file = await realpath(path).catch(() => undefined);
  if (dir === undefined || file === undefined || !isInside(dir, file)) {
    throw new HttpError(
      400,
      `The ${label} must be a file added on this page since the UI server started. Add it again.`
    );
  }
  return file;
}

async function hasAudioStream(path: string): Promise<boolean> {
  const { stdout } = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=index",
      "-of",
      "csv=p=0",
      path
    ],
    { timeout: 30_000 }
  ).catch((error: unknown) => {
    throw new Error(
      `Could not check the template video for audio with ffprobe; install ffmpeg (brew install ffmpeg) or turn off keeping the original audio. ${errorMessage(error)}`
    );
  });
  return stdout.trim() !== "";
}

async function animate(req: IncomingMessage, res: ServerResponse) {
  if (contentType(req) !== "application/json") {
    throw new HttpError(415, "Expected application/json");
  }
  const input = animateSchema.safeParse(await readJson(req).catch(() => null));
  if (!input.success) {
    throw new HttpError(
      400,
      input.error.issues.map((issue) => issue.message).join("; ")
    );
  }
  const controlVideoPath = await stagedFile(
    input.data.controlVideoPath,
    "template video"
  );
  const characterImagePath = await stagedFile(
    input.data.characterImagePath,
    "template image"
  );
  if (submitting) {
    throw new HttpError(
      409,
      "Another animation is still being sent to Maestro. Wait until it is queued before generating again."
    );
  }
  submitting = true;
  try {
    const silent =
      input.data.keepAudio && !(await hasAudioStream(controlVideoPath));
    const audio: AudioMode =
      input.data.keepAudio && !silent ? "control" : "none";
    console.error(
      `Animating ${controlVideoPath} with ${characterImagePath} (audio ${audio})`
    );
    const job = await animator.start({
      controlVideoPath,
      characterImagePath,
      audio
    });
    console.error(`Queued Maestro job ${job.jobId}`);
    send(res, 200, {
      ...job,
      audio,
      ...(silent && { audioNote: silentNote })
    });
  } finally {
    submitting = false;
  }
}

function parseRange(
  header: string | undefined,
  size: number
): { start: number; end: number } | "unsatisfiable" | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
  if (match === null) return undefined;
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return undefined;
  if (first === "") {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  const end = last === "" ? Infinity : Number(last);
  if (end < start) return undefined;
  if (start >= size) return "unsatisfiable";
  return { start, end: Math.min(end, size - 1) };
}

function attachment(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function media(req: IncomingMessage, res: ServerResponse, url: URL) {
  const notFound = new HttpError(404, "Not found");
  const requested = url.searchParams.get("path");
  if (!requested) throw notFound;
  const [outputDir, file] = await Promise.all([
    realpath(config.maestroOutputDir),
    realpath(requested)
  ]).catch(() => {
    throw notFound;
  });
  if (!isInside(outputDir, file)) throw notFound;
  const info = await stat(file);
  if (!info.isFile()) throw notFound;
  const headers: Record<string, string | number> = {
    "content-type":
      mediaTypes[extname(file).toLowerCase()] ?? "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "no-cache",
    "last-modified": info.mtime.toUTCString(),
    "x-content-type-options": "nosniff",
    ...(url.searchParams.get("download") === "1" && {
      "content-disposition": attachment(basename(file))
    })
  };
  const range = parseRange(req.headers.range, info.size);
  if (range === "unsatisfiable") {
    res.writeHead(416, {
      "content-type": "application/json",
      "accept-ranges": "bytes",
      "content-range": `bytes */${info.size}`
    });
    res.end(JSON.stringify({ error: "Requested range not satisfiable" }));
    return;
  }
  const { start, end } = range ?? { start: 0, end: info.size - 1 };
  res.writeHead(range === undefined ? 200 : 206, {
    ...headers,
    "content-length": end - start + 1,
    ...(range !== undefined && {
      "content-range": `bytes ${start}-${end}/${info.size}`
    })
  });
  if (req.method === "HEAD" || end < start) {
    res.end();
    return;
  }
  await pipeline(createReadStream(file, { start, end }), res);
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (!allowedHosts.has(req.headers.host ?? "")) {
    send(res, 403, { error: "Forbidden host" });
    return;
  }
  const origin = req.headers.origin;
  if (
    req.method !== "GET" &&
    req.method !== "HEAD" &&
    origin !== undefined &&
    !allowedOrigins.has(origin)
  ) {
    send(res, 403, { error: "Forbidden origin" });
    return;
  }
  const url = new URL(req.url ?? "/", `http://${host}`);
  switch (`${req.method ?? ""} ${url.pathname}`) {
    case "GET /":
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page);
      return;
    case "POST /api/post":
      await postReel(req, res);
      return;
    case "GET /api/status":
      send(res, 200, await publisher.getPostStatus(requireId(url)));
      return;
    case "GET /api/animate/config":
      send(res, 200, {
        enabled: config.maestroUrl !== undefined,
        ...(config.maestroUrl && { maestroUrl: config.maestroUrl })
      });
      return;
    case "POST /api/upload":
      await upload(req, res, url);
      return;
    case "POST /api/animate":
      await animate(req, res);
      return;
    case "GET /api/animate/status":
      send(res, 200, await animator.getStatus(requireId(url)));
      return;
    case "POST /api/animate/cancel":
      send(res, 200, await animator.cancel(requireId(url)));
      return;
    case "GET /api/media":
    case "HEAD /api/media":
      await media(req, res, url);
      return;
  }
  send(res, 404, { error: "Not found" });
}

function errorStatus(error: unknown): number {
  if (error instanceof HttpError) return error.status;
  if (error instanceof MaestroError) return error.status === 404 ? 404 : 502;
  return 500;
}

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143]
] as const) {
  process.once(signal, () => process.exit(code));
}

createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    if (res.headersSent || res.destroyed) {
      res.destroy();
      return;
    }
    const message = errorMessage(error);
    console.error(message);
    send(res, errorStatus(error), { error: message });
  });
}).listen(config.uiPort, host, () => {
  console.error(`Instagram Reel UI at http://${host}:${config.uiPort}`);
});
