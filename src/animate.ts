import { randomUUID } from "node:crypto";
import { mkdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve
} from "node:path";
import { MaestroError } from "./maestro.js";
import type {
  Character,
  JobStatus,
  JobStatusName,
  MaestroClient
} from "./maestro.js";

export const resolutions = [
  "auto_480p",
  "auto_540p",
  "auto_720p",
  "auto_768p",
  "auto_1080p"
] as const;
export type Resolution = (typeof resolutions)[number];

export const audioModes = ["none", "control", "custom"] as const;
export type AudioMode = (typeof audioModes)[number];

export const imageModels = ["flux2_klein_9b", "flux2_klein_4b"] as const;
export type ImageModel = (typeof imageModels)[number];

export interface AnimationRequest {
  controlVideoPath: string;
  editedFramePath?: string | undefined;
  characterImagePath?: string | undefined;
  character?: string | undefined;
  audio: AudioMode;
  audioPath?: string | undefined;
  resolution?: Resolution | undefined;
  seed?: number | undefined;
  trimStart?: number | undefined;
  trimEnd?: number | undefined;
  frameSeconds?: number | undefined;
  imageModel?: ImageModel | undefined;
}

export interface AnimationJob {
  jobId: string;
  queued: boolean;
  maestroUrl: string;
  controlVideoSeconds?: number;
}

export type AnimationState =
  "queued" | "running" | "completed" | "failed" | "cancelled";

export interface AnimationStatus {
  jobId: string;
  state: AnimationState;
  progress: number;
  phase?: string;
  message?: string;
  outputs?: string[];
  error?: string;
}

export interface MaestroCharacter {
  id: string;
  name: string;
}

export interface AnimatorOptions {
  outputDir: string;
  resolution: Resolution;
  workspace?: string;
  researchDir: string;
}

const fps = 24;
const maxUploadBytes = 500 * 1024 * 1024;
const videoExtensions = [".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi"];
const imageExtensions = [".png", ".jpg", ".jpeg", ".webp"];
const audioExtensions = [".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg"];
const viggleModel = "viggle_animate";
const swapPrompt =
  "Replace the main character in source frame with character in second image. Preserve the exact pose, body orientation, hands, props, background, camera framing, lighting and image dimensions.";

const audioPromptTypes: Record<AudioMode, "" | "K" | "A"> = {
  none: "",
  control: "K",
  custom: "A"
};

type Source =
  | { kind: "frame"; path: string }
  | { kind: "image"; path: string }
  | { kind: "saved"; query: string };

interface ValidRequest {
  controlVideoPath: string;
  source: Source;
  audioPath?: string;
  trimStart?: number;
  trimEnd?: number;
  frameSeconds?: number;
}

interface CharacterReference {
  reference_path: string;
  reference_url: string;
  character_name: string;
  character_id?: string;
  view_id?: string;
}

interface Timeline {
  start: number;
  end: number;
  frame: number;
  frames: number;
}

const missingClientMessage =
  "MAESTRO_URL is not set. Set it to the Maestro address, for example https://maestro-pc.tailnet-name.ts.net from Secure Remote Access in Pinokio.";

export class Animator {
  constructor(
    private readonly client: MaestroClient | undefined,
    private readonly options: AnimatorOptions
  ) {}

  async start(request: AnimationRequest): Promise<AnimationJob> {
    const client = this.requireClient();
    const valid = await this.validate(request);
    const imageModel = request.imageModel ?? "flux2_klein_9b";
    await checkModels(client, valid.source.kind !== "frame", imageModel);
    const reference = await this.characterReference(client, valid.source);
    const control = await client.upload(valid.controlVideoPath);
    const duration = positive(control.duration_seconds);
    const timeline = buildTimeline(valid, duration);
    const frame =
      valid.source.kind === "frame"
        ? await client.upload(valid.source.path)
        : undefined;
    const audio =
      valid.audioPath === undefined
        ? undefined
        : await client.upload(valid.audioPath);
    const body = {
      model_type: viggleModel,
      generation_mode: "video",
      _studio_video_workflow: "animate",
      image_mode: 0,
      prompt: "Viggle Animate",
      video_guide: control.path,
      image_refs: frame === undefined ? [] : [frame.path],
      ...(reference === undefined
        ? {}
        : {
            viggle_character: {
              ...reference,
              image_model: imageModel,
              frame_seconds: timeline.frame,
              swap_prompt: swapPrompt,
              appearance_prompt: ""
            }
          }),
      audio_prompt_type: audioPromptTypes[request.audio],
      ...(audio === undefined ? {} : { audio_guide: audio.path }),
      resolution: request.resolution ?? this.options.resolution,
      seed: request.seed ?? -1,
      video_length: timeline.frames,
      ...(duration === undefined ? {} : { _viggle_source_seconds: duration }),
      _viggle_trim_start: timeline.start,
      _viggle_trim_end: timeline.end,
      _viggle_frame_seconds: timeline.frame,
      ...(this.options.workspace === undefined
        ? {}
        : { workspace: this.options.workspace }),
      _queue_mode: "now",
      _client_submission_id: randomUUID()
    };
    const result = await client.generate(body);
    return {
      jobId: result.job_id,
      queued: result.status === "queued" || result.status === "held",
      maestroUrl: client.baseUrl,
      ...(duration === undefined ? {} : { controlVideoSeconds: duration })
    };
  }

  async getStatus(jobId: string): Promise<AnimationStatus> {
    const client = this.requireClient();
    const status = await client.status(jobId);
    if (status === undefined) {
      throw new MaestroError(
        `Maestro at ${client.baseUrl} has no record of job ${jobId}. It may have restarted, which clears its job list; look for the result in the Maestro gallery.`,
        404
      );
    }
    const base = describe(status);
    if (base.state !== "completed") return base;
    const outputs = await this.downloadOutputs(client, status);
    if (outputs.length === 0) {
      return {
        jobId: base.jobId,
        state: "failed",
        progress: base.progress,
        error:
          "Maestro finished without producing a video; an input file was probably missing on the Maestro host."
      };
    }
    return { ...base, outputs };
  }

  async cancel(jobId: string): Promise<AnimationStatus> {
    const client = this.requireClient();
    await client.cancel(jobId);
    return this.getStatus(jobId);
  }

  async listCharacters(): Promise<MaestroCharacter[]> {
    const client = this.requireClient();
    return (await client.characters()).map(({ id, name }) => ({ id, name }));
  }

  private requireClient(): MaestroClient {
    if (this.client === undefined) throw new Error(missingClientMessage);
    return this.client;
  }

  private async validate(request: AnimationRequest): Promise<ValidRequest> {
    const controlVideoPath = await checkFile(
      expandPath(request.controlVideoPath, "controlVideoPath"),
      "controlVideoPath",
      videoExtensions
    );
    await this.refuseResearchClip(controlVideoPath);
    const source = await sourceOf(request);
    if (request.audio === "custom" && request.audioPath === undefined) {
      throw new Error('audioPath is required when audio is "custom".');
    }
    if (request.audio !== "custom" && request.audioPath !== undefined) {
      throw new Error(
        'audioPath is only used when audio is "custom". Remove it or set audio to "custom".'
      );
    }
    const audioPath =
      request.audioPath === undefined
        ? undefined
        : await checkFile(
            expandPath(request.audioPath, "audioPath"),
            "audioPath",
            audioExtensions
          );
    if (
      request.seed !== undefined &&
      (!Number.isSafeInteger(request.seed) || request.seed < -1)
    ) {
      throw new Error("seed must be a whole number, or -1 for a random seed.");
    }
    const trimStart = seconds(request.trimStart, "trimStart");
    const trimEnd = seconds(request.trimEnd, "trimEnd");
    const frameSeconds = seconds(request.frameSeconds, "frameSeconds");
    const start = trimStart ?? 0;
    if (trimEnd !== undefined && trimEnd - start < 1 / fps) {
      throw new Error(
        `trimEnd must be at least one frame (1/${fps} s) after trimStart.`
      );
    }
    if (frameSeconds !== undefined && frameSeconds < start) {
      throw new Error("frameSeconds must not be before trimStart.");
    }
    if (
      frameSeconds !== undefined &&
      trimEnd !== undefined &&
      frameSeconds >= trimEnd
    ) {
      throw new Error("frameSeconds must be before trimEnd.");
    }
    return {
      controlVideoPath,
      source,
      ...(audioPath === undefined ? {} : { audioPath }),
      ...(trimStart === undefined ? {} : { trimStart }),
      ...(trimEnd === undefined ? {} : { trimEnd }),
      ...(frameSeconds === undefined ? {} : { frameSeconds })
    };
  }

  private async refuseResearchClip(path: string): Promise<void> {
    const video = await realpath(path).catch(() => path);
    const researchDir = await realpath(this.options.researchDir).catch(() =>
      resolve(this.options.researchDir)
    );
    const inside = relative(researchDir, video);
    if (inside !== "" && !inside.startsWith("..") && !isAbsolute(inside)) {
      throw new Error(
        `"${path}" is inside the trend research folder "${researchDir}". Reference clips from research are for format study only and must not be animated or reposted. Use your own footage as the control video.`
      );
    }
  }

  private async characterReference(
    client: MaestroClient,
    source: Source
  ): Promise<CharacterReference | undefined> {
    switch (source.kind) {
      case "frame":
        return undefined;
      case "image": {
        const upload = await client.upload(source.path);
        return {
          reference_path: upload.path,
          reference_url: upload.url,
          character_name: basename(source.path)
        };
      }
      case "saved":
        return savedCharacterReference(client, source.query);
    }
  }

  private async downloadOutputs(
    client: MaestroClient,
    status: JobStatus
  ): Promise<string[]> {
    const names = status.output_files ?? [];
    if (names.length === 0) return [];
    const outputDir = resolve(this.options.outputDir);
    await mkdir(outputDir, { recursive: true });
    const outputs: string[] = [];
    for (const name of names) {
      const destination = join(outputDir, basename(name.replace(/\\/g, "/")));
      if (!(await isNonEmptyFile(destination))) {
        await client.downloadFile(name, destination, this.options.workspace);
      }
      outputs.push(destination);
    }
    return outputs;
  }
}

async function checkModels(
  client: MaestroClient,
  needsImageModel: boolean,
  imageModel: ImageModel
): Promise<void> {
  const config = await client.systemConfig();
  const models = await client.models();
  const available = new Set(models.map((model) => model.model_type));
  const version =
    config.app_version === undefined || config.app_version === null
      ? "Maestro"
      : `Maestro ${config.app_version}`;
  if (!available.has(viggleModel)) {
    throw new Error(
      `${version} at ${client.baseUrl} does not list the Viggle Animate model (${viggleModel}). Update Maestro in Pinokio to a version that includes Viggle Animate.`
    );
  }
  if (needsImageModel && !available.has(imageModel)) {
    const alternative = imageModels.find(
      (model) => model !== imageModel && available.has(model)
    );
    throw new Error(
      `${version} at ${client.baseUrl} does not list ${imageModel}, which Viggle needs to place a character into the control video.${alternative === undefined ? "" : ` Set imageModel to "${alternative}" instead.`}`
    );
  }
}

async function savedCharacterReference(
  client: MaestroClient,
  query: string
): Promise<CharacterReference> {
  const character = await findCharacter(client, query);
  const ready =
    character.image_views === undefined ||
    character.image_views === null ||
    character.image_views.items.length === 0
      ? await client.recoverCharacterImages(character.id)
      : character;
  const views = ready.image_views;
  const view =
    views?.items.find((item) => item.id === views.cover_id) ?? views?.items[0];
  if (view === undefined) {
    throw new Error(
      `Maestro character "${character.name}" has no images to use. Open it in Maestro and recover its images.`
    );
  }
  const image = await client.fetchBytes(view.url);
  const upload = await client.uploadBlob(
    image,
    `${safeName(character.name)}_${view.id}.png`
  );
  return {
    reference_path: upload.path,
    reference_url: upload.url,
    character_name: character.name,
    character_id: character.id,
    view_id: view.id
  };
}

async function findCharacter(
  client: MaestroClient,
  query: string
): Promise<Character> {
  const characters = await client.characters();
  const byId = characters.find((character) => character.id === query);
  if (byId !== undefined) return byId;
  const wanted = query.toLowerCase();
  const matches = characters.filter(
    (character) => character.name.trim().toLowerCase() === wanted
  );
  const [match] = matches;
  if (match === undefined) {
    const saved =
      characters.map((character) => character.name).join(", ") || "none";
    throw new Error(
      `No saved Maestro character matches "${query}". Saved characters: ${saved}.`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Several Maestro characters are named "${query}": ${matches.map((character) => character.id).join(", ")}. Pass one of these ids as character.`
    );
  }
  return match;
}

async function sourceOf(request: AnimationRequest): Promise<Source> {
  const character = request.character?.trim();
  const given = [
    request.editedFramePath,
    request.characterImagePath,
    character === "" ? undefined : character
  ].filter((value) => value !== undefined);
  if (given.length !== 1) {
    throw new Error(
      "Provide exactly one of editedFramePath (a frame of the control video already edited to show the new character), characterImagePath (an image of the character), or character (a saved Maestro character name or id)."
    );
  }
  if (request.editedFramePath !== undefined) {
    return {
      kind: "frame",
      path: await checkFile(
        expandPath(request.editedFramePath, "editedFramePath"),
        "editedFramePath",
        imageExtensions
      )
    };
  }
  if (request.characterImagePath !== undefined) {
    return {
      kind: "image",
      path: await checkFile(
        expandPath(request.characterImagePath, "characterImagePath"),
        "characterImagePath",
        imageExtensions
      )
    };
  }
  return { kind: "saved", query: character ?? "" };
}

function buildTimeline(
  request: ValidRequest,
  duration: number | undefined
): Timeline {
  const start = request.trimStart ?? 0;
  let end = request.trimEnd ?? duration;
  if (end === undefined) {
    throw new Error(
      "Maestro could not read the control video's duration. Pass trimEnd in seconds to choose how much of it to animate."
    );
  }
  if (duration !== undefined) {
    if (start >= duration) {
      throw new Error(
        `trimStart (${start} s) is past the end of the ${duration} s control video.`
      );
    }
    if (end > duration + 1 / fps) {
      throw new Error(
        `trimEnd (${end} s) is past the end of the ${duration} s control video.`
      );
    }
    end = Math.min(end, duration);
  }
  if (end - start < 1 / fps) {
    throw new Error(
      `The selected range must be at least one frame (1/${fps} s) long.`
    );
  }
  const frame = request.frameSeconds ?? start;
  if (frame >= end) {
    throw new Error(
      `frameSeconds (${frame} s) must be before the end of the selected range (${end} s).`
    );
  }
  const frames = Math.max(1, Math.floor((end - start) * fps + 1e-6));
  if (frames > fps * 3600) {
    throw new Error("Viggle can animate at most one hour of control video.");
  }
  return { start, end, frame, frames };
}

function describe(status: JobStatus): AnimationStatus {
  const state = animationState(status.status);
  const progress =
    state === "completed"
      ? 100
      : Math.round(Math.min(100, Math.max(0, status.progress ?? 0)));
  const phase = text(status.phase);
  const message = text(status.message);
  const detail = text(status.error);
  const error =
    state !== "failed"
      ? undefined
      : detail !== undefined
        ? detail.replace(/^Error:\s*/, "")
        : `${text(message?.replace(/^Error:\s*/, "")) ?? "Maestro reported a failure"}. Details are in Maestro's log in Pinokio.`;
  return {
    jobId: status.job_id,
    state,
    progress,
    ...(phase === undefined ? {} : { phase }),
    ...(message === undefined ? {} : { message }),
    ...(error === undefined ? {} : { error })
  };
}

function animationState(status: JobStatusName): AnimationState {
  switch (status) {
    case "held":
    case "queued":
      return "queued";
    case "running":
    case "completed":
    case "failed":
    case "cancelled":
      return status;
  }
}

function text(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

function positive(value: number | null | undefined): number | undefined {
  return value !== undefined &&
    value !== null &&
    Number.isFinite(value) &&
    value > 0
    ? value
    : undefined;
}

function seconds(value: number | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || value > 3600) {
    throw new Error(`${field} must be a number of seconds from 0 to 3600.`);
  }
  return value;
}

function expandPath(path: string, field: string): string {
  const expanded = path.startsWith("~/")
    ? join(homedir(), path.slice(2))
    : path;
  if (!isAbsolute(expanded)) {
    throw new Error(`${field} must be an absolute path, got "${path}"`);
  }
  return resolve(expanded);
}

async function checkFile(
  path: string,
  field: string,
  extensions: string[]
): Promise<string> {
  const extension = extname(path).toLowerCase();
  if (!extensions.includes(extension)) {
    throw new Error(
      `${field} must be a ${extensions.join(", ")} file, got "${path}"`
    );
  }
  const info = await stat(path).catch(() => undefined);
  if (info?.isFile() !== true) {
    throw new Error(`${field}: no file found at "${path}"`);
  }
  if (info.size === 0) {
    throw new Error(`${field}: "${path}" is empty`);
  }
  if (info.size > maxUploadBytes) {
    throw new Error(
      `${field}: "${path}" is larger than Maestro's 500 MB upload limit`
    );
  }
  return path;
}

async function isNonEmptyFile(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => undefined);
  return info?.isFile() === true && info.size > 0;
}

function safeName(name: string): string {
  return name.replace(/[^\p{L}\p{N}_-]+/gu, "_") || "character";
}
