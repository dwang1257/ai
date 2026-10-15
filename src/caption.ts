import type Anthropic from "@anthropic-ai/sdk";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { validateVideo } from "./instagram.js";

const run = promisify(execFile);
const frameCount = 6;
const maxWords = 15;
const forbidden =
  /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u2013\u2014:#]/u;

const instructions = [
  "You write Instagram Reel captions.",
  "The images are frames sampled in order from one Reel.",
  "Write one short, creative caption of 5 to 7 words that hooks the viewer and matches what the Reel shows.",
  'Be inventive and play with wordplay, an unexpected angle, a playful observation, or a curious question, and avoid generic filler like "vibes" or "living my best life".',
  "It can be a statement, an exclamation, or a question; do not default to a question.",
  "Keep it completely safe for work and suitable for a general audience, with no sexual content or innuendo, no comments on bodies or appearance, no profanity, no violence, no drugs or alcohol, and nothing edgy or suggestive, even if the video leans that way.",
  "If the frames themselves look suggestive, describe only the neutral setting or activity.",
  "Never use emojis, em dashes, en dashes, colons, hashtags, or line breaks.",
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
      model: "claude-sonnet-5-5",
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
    const caption = text.replace(/\s+/g, " ");
    if (forbidden.test(caption)) {
      throw new Error(
        `Claude wrote a caption with an emoji, dash, colon, or hashtag, so nothing was posted: "${caption}"`
      );
    }
    if (caption.split(" ").length > maxWords) {
      throw new Error(
        `Claude wrote a caption longer than ${maxWords} words, so nothing was posted: "${caption}"`
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
