import type Anthropic from "@anthropic-ai/sdk";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { validateVideo } from "./instagram.js";

const run = promisify(execFile);
const frameCount = 6;
const maxCaptionLength = 2200;

const instructions = [
  "You write Instagram Reel captions.",
  "The images are frames sampled in order from one Reel.",
  "Write a caption of one to three short lines that hooks the viewer and matches what the Reel shows.",
  "Keep it completely safe for work and suitable for a general audience: no sexual content or innuendo, no comments on bodies or appearance, no profanity, no violence, no drugs or alcohol, and nothing edgy or suggestive, even if the video leans that way.",
  "If the frames themselves look suggestive, describe only the neutral setting or activity.",
  "You may add up to three relevant hashtags, but put them before the final line and keep them equally clean.",
  "The final line must be a question to the viewer, so the last character of the caption is a question mark.",
  "Reply with only the caption text."
].join("\n");

export class CaptionWriter {
  constructor(
    private readonly client: Anthropic,
    private readonly ffmpegPath = "ffmpeg",
    private readonly ffprobePath = "ffprobe"
  ) {}

  async write(videoPath: string): Promise<string> {
    const path = await validateVideo(videoPath);
    const frames = await this.extractFrames(path);
    const response = await this.client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: instructions,
      messages: [
        {
          role: "user",
          content: [
            ...frames.map((data) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: "image/jpeg" as const,
                data
              }
            })),
            { type: "text", text: "Write the caption for this Reel." }
          ]
        }
      ]
    });
    if (response.stop_reason === "refusal") {
      throw new Error("Claude declined to caption this video");
    }
    const text = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("")
      .trim();
    if (!text) {
      throw new Error("Claude returned an empty caption");
    }
    const caption = endWithQuestion(text);
    if (caption.length > maxCaptionLength) {
      throw new Error(
        `Generated caption is longer than ${maxCaptionLength} characters`
      );
    }
    return caption;
  }

  private async extractFrames(path: string): Promise<string[]> {
    const { stdout } = await run(
      this.ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        path
      ],
      { timeout: 30_000 }
    ).catch((error: unknown) => {
      throw new Error(
        `Could not read the video with ffprobe; install ffmpeg (brew install ffmpeg). ${error instanceof Error ? error.message : String(error)}`
      );
    });
    const duration = Number.parseFloat(stdout);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`Could not read the duration of "${path}"`);
    }
    const dir = await mkdtemp(join(tmpdir(), "reel-frames-"));
    try {
      await run(
        this.ffmpegPath,
        [
          "-v",
          "error",
          "-i",
          path,
          "-vf",
          `fps=${frameCount / duration},scale=768:-2`,
          "-frames:v",
          String(frameCount),
          join(dir, "%02d.jpg")
        ],
        { timeout: 120_000 }
      );
      const files = (await readdir(dir)).filter((file) =>
        file.endsWith(".jpg")
      );
      if (files.length === 0) {
        throw new Error(`ffmpeg extracted no frames from "${path}"`);
      }
      return await Promise.all(
        files
          .sort()
          .map(async (file) =>
            (await readFile(join(dir, file))).toString("base64")
          )
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

export function endWithQuestion(caption: string): string {
  const trimmed = caption.trim().replace(/[\s.!…]+$/u, "");
  return trimmed.endsWith("?") ? trimmed : `${trimmed}?`;
}
