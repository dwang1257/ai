import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const timeoutMs = 5 * 60 * 1000;

export interface DownloadOptions {
  ytdlpPath: string;
  cookiesFromBrowser?: string;
}

export async function downloadVideo(
  url: string,
  outputBase: string,
  options: DownloadOptions
): Promise<string> {
  const args = [
    "--no-playlist",
    "--no-progress",
    "--no-warnings",
    "--quiet",
    "--no-simulate",
    "--max-filesize",
    "512M",
    "-f",
    "bv*+ba/b",
    "-S",
    "vcodec:h264,acodec:aac,ext:mp4:m4a",
    "--merge-output-format",
    "mp4",
    "--remux-video",
    "mp4",
    "--print",
    "after_move:filepath",
    "-o",
    `${outputBase}.%(ext)s`,
    ...(options.cookiesFromBrowser === undefined
      ? []
      : ["--cookies-from-browser", options.cookiesFromBrowser]),
    "--",
    url
  ];
  const stdout = await run(options.ytdlpPath, args, {
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: childEnv(options.ytdlpPath)
  }).then(
    (result) => result.stdout,
    (error: unknown) => {
      throw downloadError(error, options.ytdlpPath);
    }
  );
  const printed = lastLine(stdout);
  if (printed === undefined) {
    throw new Error(
      "yt-dlp finished without saving a file. The video may be larger than 512 MB or unavailable."
    );
  }
  const path = resolve(printed);
  const info = await stat(path).catch(() => undefined);
  if (info?.isFile() !== true) {
    throw new Error(`yt-dlp reported "${path}" but no file exists there.`);
  }
  return path;
}

function childEnv(ytdlpPath: string): NodeJS.ProcessEnv {
  if (!isAbsolute(ytdlpPath)) return process.env;
  const path = process.env.PATH ?? "";
  return { ...process.env, PATH: [dirname(ytdlpPath), path].join(delimiter) };
}

function downloadError(error: unknown, ytdlpPath: string): Error {
  if (!(error instanceof Error)) return new Error(String(error));
  const details = error as Error & {
    code?: unknown;
    killed?: boolean;
    stderr?: unknown;
  };
  if (details.code === "ENOENT") {
    return new Error(
      `yt-dlp not found at "${ytdlpPath}". Install it with brew install yt-dlp or set YTDLP_PATH.`
    );
  }
  if (details.killed === true) {
    return new Error(`yt-dlp timed out after ${timeoutMs / 60000} minutes.`);
  }
  const stderr = typeof details.stderr === "string" ? details.stderr : "";
  const message = lastErrorLine(stderr);
  return new Error(message ?? `yt-dlp failed: ${error.message}`);
}

function lastErrorLine(stderr: string): string | undefined {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const errorLine = lines.findLast((line) => line.startsWith("ERROR:"));
  const line = errorLine ?? lines.at(-1);
  return line?.replace(/^ERROR:\s*/, "");
}

function lastLine(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .findLast((line) => line !== "");
}
