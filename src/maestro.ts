import { randomUUID } from "node:crypto";
import { createWriteStream, openAsBlob } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";

export class MaestroError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "MaestroError";
  }
}

export class MaestroConnectionError extends MaestroError {
  constructor(message: string) {
    super(message);
    this.name = "MaestroConnectionError";
  }
}

const jsonTimeoutMs = 30_000;
const generateTimeoutMs = 120_000;
const transferTimeoutMs = 30 * 60_000;
const characterRecoveryTimeoutMs = 10 * 60_000;
const lookupDelaysMs = [0, 1_000, 3_000];

export const jobStatuses = [
  "held",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled"
] as const;

const jobStatusSchema = z.enum(jobStatuses);

const optionalNumber = z.number().nullish().catch(null);

const systemConfigSchema = z.looseObject({
  app_version: z.string().nullish()
});

const modelSchema = z.looseObject({
  model_type: z.string(),
  name: z.string().nullish(),
  is_downloaded: z.boolean().nullish()
});

const modelsSchema = z.looseObject({ models: z.array(modelSchema) });

const uploadSchema = z.looseObject({
  filename: z.string(),
  path: z.string(),
  url: z.string(),
  fps: z.number().nullish(),
  frame_count: z.number().nullish(),
  duration_seconds: z.number().nullish(),
  has_audio: z.boolean().nullish()
});

const generateResultSchema = z.looseObject({
  job_id: z.string(),
  status: jobStatusSchema,
  client_submission_id: z.string().nullish()
});

const jobStatusResponseSchema = z.looseObject({
  job_id: z.string(),
  status: jobStatusSchema,
  progress: z.number().nullish(),
  step: z.number().nullish(),
  total_steps: z.number().nullish(),
  phase: z.string().nullish(),
  message: z.string().nullish(),
  output_files: z.array(z.string()).nullish(),
  error: z.string().nullish(),
  generation_completion_at: optionalNumber,
  generation_eta_seconds: optionalNumber,
  eta_updated_at: optionalNumber
});

const jobsSchema = z.looseObject({
  jobs: z.array(
    z.looseObject({
      job_id: z.string(),
      client_submission_id: z.string().nullish(),
      status: jobStatusSchema
    })
  )
});

const cancelSchema = z.looseObject({ status: z.string() });

const characterSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  image_views: z
    .looseObject({
      cover_id: z.string().nullish(),
      items: z.array(z.looseObject({ id: z.string(), url: z.string() }))
    })
    .nullish()
});

const charactersSchema = z.looseObject({
  characters: z.array(characterSchema)
});

const characterTransferStartSchema = z.looseObject({
  id: z.string(),
  status: z.string()
});

const characterTransferSchema = z.looseObject({
  id: z.string(),
  status: z.enum(["running", "completed", "failed"]),
  message: z.string().nullish(),
  error: z.string().nullish(),
  result: z.looseObject({ character: characterSchema }).nullish()
});

const errorDetailSchema = z.looseObject({ detail: z.unknown() });

export type JobStatusName = z.infer<typeof jobStatusSchema>;
export type SystemConfig = z.infer<typeof systemConfigSchema>;
export type MaestroModel = z.infer<typeof modelSchema>;
export type Upload = z.infer<typeof uploadSchema>;
export type GenerateResult = z.infer<typeof generateResultSchema>;
export type JobStatus = z.infer<typeof jobStatusResponseSchema>;
export type ActiveJob = z.infer<typeof jobsSchema>["jobs"][number];
export type Character = z.infer<typeof characterSchema>;
export type CharacterTransfer = z.infer<typeof characterTransferSchema>;

export type GenerateRequest = Record<string, unknown> & {
  _client_submission_id: string;
};

export class MaestroClient {
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.trim().replace(/\/+$/, "");
  }

  async systemConfig(): Promise<SystemConfig> {
    return this.json("GET", "/api/v1/system-config", systemConfigSchema);
  }

  async models(): Promise<MaestroModel[]> {
    return (await this.json("GET", "/api/v1/models", modelsSchema)).models;
  }

  async upload(localPath: string, filename?: string): Promise<Upload> {
    return this.uploadBlob(
      await openAsBlob(localPath),
      filename ?? basename(localPath)
    );
  }

  async uploadBlob(content: Blob, filename: string): Promise<Upload> {
    const form = new FormData();
    form.append("file", content, filename);
    const path = "/api/v1/upload";
    const response = await this.send(
      "POST",
      path,
      { body: form },
      transferTimeoutMs
    );
    return this.parse(path, uploadSchema, await this.read(path, response));
  }

  async generate(body: GenerateRequest): Promise<GenerateResult> {
    const path = "/api/v1/generate";
    let failure: unknown;
    try {
      const response = await this.send(
        "POST",
        path,
        {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        },
        generateTimeoutMs
      );
      if (!response.ok) await this.read(path, response);
      const json: unknown = await response.json();
      return this.parse(path, generateResultSchema, json);
    } catch (error) {
      if (error instanceof MaestroError && error.status !== undefined) {
        throw error;
      }
      failure = error;
    }
    const accepted = await this.findSubmission(body._client_submission_id);
    if (accepted !== undefined) {
      return {
        job_id: accepted.job_id,
        status: accepted.status,
        client_submission_id: body._client_submission_id
      };
    }
    throw new MaestroError(
      `The Maestro generate request did not get a usable response (${errorMessage(failure)}), and Maestro's queue shows no job for this submission. The outcome is unknown: check the queue in Maestro at ${this.baseUrl} before trying again, since a retry could start a second animation.`
    );
  }

  async status(jobId: string): Promise<JobStatus | undefined> {
    const path = `/api/v1/status/${encodeURIComponent(jobId)}`;
    const response = await this.send("GET", path, {}, jsonTimeoutMs);
    if (response.status === 404) return undefined;
    return this.parse(
      path,
      jobStatusResponseSchema,
      await this.read(path, response)
    );
  }

  async jobs(): Promise<ActiveJob[]> {
    return (await this.json("GET", "/api/v1/jobs", jobsSchema)).jobs;
  }

  async cancel(jobId: string): Promise<boolean> {
    const path = `/api/v1/cancel/${encodeURIComponent(jobId)}`;
    const response = await this.send("POST", path, {}, jsonTimeoutMs);
    if (response.status === 404) return false;
    this.parse(path, cancelSchema, await this.read(path, response));
    return true;
  }

  async downloadFile(
    name: string,
    destPath: string,
    workspace?: string
  ): Promise<void> {
    const query =
      workspace === undefined
        ? ""
        : `?${new URLSearchParams({ workspace }).toString()}`;
    const path = `/api/v1/file/${encodeURIComponent(name)}${query}`;
    const response = await this.send("GET", path, {}, transferTimeoutMs);
    if (!response.ok) await this.read(path, response);
    if (response.body === null) {
      throw new MaestroError(
        `Maestro GET ${stripQuery(path)} returned an empty body`,
        response.status
      );
    }
    const temp = `${destPath}.${randomUUID()}.part`;
    try {
      await pipeline(
        Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
        createWriteStream(temp, { flags: "wx" })
      );
      await rename(temp, destPath);
    } catch (error) {
      await rm(temp, { force: true });
      throw new MaestroError(
        `Downloading ${name} from Maestro failed: ${errorMessage(error)}`
      );
    }
  }

  async characters(): Promise<Character[]> {
    return (await this.json("GET", "/api/v1/characters", charactersSchema))
      .characters;
  }

  async startCharacterImageRecovery(characterId: string): Promise<string> {
    const path = `/api/v1/characters/${encodeURIComponent(characterId)}/images/recover?force=false`;
    const response = await this.json(
      "POST",
      path,
      characterTransferStartSchema
    );
    return response.id;
  }

  async characterTransfer(transferId: string): Promise<CharacterTransfer> {
    return this.json(
      "GET",
      `/api/v1/character-transfers/${encodeURIComponent(transferId)}`,
      characterTransferSchema
    );
  }

  async recoverCharacterImages(characterId: string): Promise<Character> {
    const transferId = await this.startCharacterImageRecovery(characterId);
    const deadline = Date.now() + characterRecoveryTimeoutMs;
    for (;;) {
      const transfer = await this.characterTransfer(transferId);
      if (transfer.status === "failed") {
        throw new MaestroError(
          `Maestro could not recover the character's images: ${transfer.error ?? transfer.message ?? "unknown error"}`
        );
      }
      if (transfer.status === "completed") {
        const character = transfer.result?.character;
        if (character === undefined) {
          throw new MaestroError(
            "Maestro recovered the character's images but returned no character."
          );
        }
        return character;
      }
      if (Date.now() > deadline) {
        throw new MaestroError(
          `Maestro is still recovering the character's images after ${characterRecoveryTimeoutMs / 60_000} minutes. Open the character in Maestro and try again once it is ready.`
        );
      }
      await sleep(1_000);
    }
  }

  async fetchBytes(relativeUrl: string): Promise<Blob> {
    if (!relativeUrl.startsWith("/") || relativeUrl.startsWith("//")) {
      throw new MaestroError(
        `Maestro returned a media URL that is not relative to its address: "${relativeUrl}"`
      );
    }
    const response = await this.send("GET", relativeUrl, {}, transferTimeoutMs);
    if (!response.ok) await this.read(relativeUrl, response);
    try {
      return await response.blob();
    } catch (error) {
      throw new MaestroError(
        `Downloading ${stripQuery(relativeUrl)} from Maestro failed: ${errorMessage(error)}`
      );
    }
  }

  private async findSubmission(
    submissionId: string
  ): Promise<ActiveJob | undefined> {
    for (const delay of lookupDelaysMs) {
      if (delay > 0) await sleep(delay);
      try {
        const match = (await this.jobs()).find(
          (job) => job.client_submission_id === submissionId
        );
        if (match !== undefined) return match;
      } catch {
        continue;
      }
    }
    return undefined;
  }

  private async json<T>(
    method: "GET" | "POST",
    path: string,
    schema: z.ZodType<T>
  ): Promise<T> {
    const response = await this.send(method, path, {}, jsonTimeoutMs);
    return this.parse(path, schema, await this.read(path, response));
  }

  private async send(
    method: "GET" | "POST",
    path: string,
    init: Pick<RequestInit, "body" | "headers">,
    timeoutMs: number
  ): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        method,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new MaestroConnectionError(
          `Maestro at ${this.baseUrl} did not answer ${method} ${stripQuery(path)} within ${timeoutMs / 1000} s.`
        );
      }
      throw new MaestroConnectionError(
        `Cannot reach Maestro at ${this.baseUrl}: ${connectionCause(error)}. Check MAESTRO_URL, that Maestro is running in Pinokio, and that this machine can reach it over Tailscale or the local network.`
      );
    }
  }

  private async read(path: string, response: Response): Promise<unknown> {
    const text = await response.text().catch(() => "");
    const json = parseJson(text);
    if (!response.ok) {
      const detail = errorDetail(json) ?? text.trim().slice(0, 500);
      throw new MaestroError(
        `Maestro ${stripQuery(path)} returned HTTP ${response.status}${detail === "" ? "" : `: ${detail}`}`,
        response.status
      );
    }
    return json;
  }

  private parse<T>(path: string, schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new MaestroError(
        `Unexpected Maestro response from ${stripQuery(path)}: ${z.prettifyError(parsed.error)}`
      );
    }
    return parsed.data;
  }
}

function errorDetail(json: unknown): string | undefined {
  const parsed = errorDetailSchema.safeParse(json);
  if (!parsed.success) return undefined;
  const { detail } = parsed.data;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map(validationIssue).join("; ");
  }
  return detail === undefined || detail === null
    ? undefined
    : JSON.stringify(detail);
}

function validationIssue(issue: unknown): string {
  if (typeof issue !== "object" || issue === null) return String(issue);
  const { msg, loc } = issue as { msg?: unknown; loc?: unknown };
  const where = Array.isArray(loc) ? loc.map(String).join(".") : "";
  const message = typeof msg === "string" ? msg : JSON.stringify(issue);
  return where === "" ? message : `${where}: ${message}`;
}

function connectionCause(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause: unknown = error.cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    return typeof code === "string" && !cause.message.includes(code)
      ? `${code} ${cause.message}`
      : cause.message;
  }
  return error.message;
}

function stripQuery(path: string): string {
  return path.split("?")[0] ?? path;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
