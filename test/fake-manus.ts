import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import type { AddressInfo } from "node:net";

export type Endpoint =
  | "connector.list"
  | "file.upload"
  | "task.create"
  | "task.detail"
  | "task.listMessages";

export interface FakeConnector {
  id: string;
  name: string;
  type?: "builtin" | "byok" | "mcp";
}

export interface FakeTask {
  status: "running" | "stopped" | "waiting" | "error";
  has_running_background_jobs?: boolean;
  events: Record<string, unknown>[];
}

export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  body: unknown;
}

export interface RecordedUpload {
  fileId: string;
  filename: string;
  bytes: Buffer;
  contentType: string | undefined;
}

interface Override {
  status: number;
  body: string;
  contentType: string;
}

export class FakeManus {
  readonly requests: RecordedRequest[] = [];
  readonly uploads: RecordedUpload[] = [];
  private connectors: FakeConnector[] = [];
  private readonly tasks = new Map<string, FakeTask>();
  private readonly pendingFiles = new Map<string, string>();
  private readonly overrides = new Map<Endpoint, Override>();
  private taskCounter = 0;

  private constructor(
    private readonly server: Server,
    readonly url: string,
    readonly apiKey: string
  ) {}

  static async start(apiKey = "test-key"): Promise<FakeManus> {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const { port } = server.address() as AddressInfo;
    const fake = new FakeManus(server, `http://127.0.0.1:${port}`, apiKey);
    server.on("request", (request, response) => {
      fake.handle(request, response).catch((error: unknown) => {
        response.writeHead(500).end(String(error));
      });
    });
    return fake;
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      })
    );
  }

  reset(): void {
    this.requests.length = 0;
    this.uploads.length = 0;
    this.connectors = [];
    this.tasks.clear();
    this.pendingFiles.clear();
    this.overrides.clear();
    this.taskCounter = 0;
  }

  setConnectors(connectors: FakeConnector[]): void {
    this.connectors = connectors;
  }

  setTask(taskId: string, task: FakeTask): void {
    this.tasks.set(taskId, task);
  }

  taskUrl(taskId: string): string {
    return `https://manus.im/app/${taskId}`;
  }

  fail(endpoint: Endpoint, status: number, code: string, message: string) {
    this.respondWith(endpoint, status, {
      ok: false,
      request_id: randomUUID(),
      error: { code, message }
    });
  }

  respondWith(endpoint: Endpoint, status: number, body: unknown): void {
    this.overrides.set(
      endpoint,
      typeof body === "string"
        ? { status, body, contentType: "text/html" }
        : {
            status,
            body: JSON.stringify(body),
            contentType: "application/json"
          }
    );
  }

  apiRequests(endpoint?: Endpoint): RecordedRequest[] {
    return this.requests.filter((request) =>
      endpoint === undefined
        ? request.path.startsWith("/v2/")
        : request.path === `/v2/${endpoint}`
    );
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const url = new URL(request.url ?? "/", this.url);
    const raw = await readBody(request);
    const isJson = request.headers["content-type"] === "application/json";
    this.requests.push({
      method: request.method ?? "",
      path: url.pathname,
      query: url.searchParams,
      headers: request.headers,
      body: isJson ? JSON.parse(raw.toString("utf8")) : undefined
    });

    const uploadMatch = /^\/upload\/([^/]+)$/.exec(url.pathname);
    if (uploadMatch?.[1] !== undefined && request.method === "PUT") {
      this.receiveUpload(uploadMatch[1], raw, request, response);
      return;
    }

    const endpoint = url.pathname.replace(/^\/v2\//, "") as Endpoint;
    const override = this.overrides.get(endpoint);
    if (override !== undefined) {
      response
        .writeHead(override.status, { "content-type": override.contentType })
        .end(override.body);
      return;
    }

    if (request.headers["x-manus-api-key"] !== this.apiKey) {
      this.sendError(
        response,
        401,
        "unauthenticated",
        "missing authentication: require either API Key or Bearer Token"
      );
      return;
    }

    const route = `${request.method ?? ""} ${url.pathname}`;
    switch (route) {
      case "GET /v2/connector.list":
        this.sendOk(
          response,
          this.connectors.length === 0 ? {} : { data: this.connectors }
        );
        return;
      case "POST /v2/file.upload":
        this.createFile(this.requests.at(-1)?.body, response);
        return;
      case "POST /v2/task.create":
        this.createTask(this.requests.at(-1)?.body, response);
        return;
      case "GET /v2/task.detail":
        this.taskDetail(url.searchParams, response);
        return;
      case "GET /v2/task.listMessages":
        this.listMessages(url.searchParams, response);
        return;
      default:
        this.sendError(response, 404, "not_found", `No route for ${route}`);
    }
  }

  private receiveUpload(
    fileId: string,
    bytes: Buffer,
    request: IncomingMessage,
    response: ServerResponse
  ): void {
    const filename = this.pendingFiles.get(fileId);
    if (filename === undefined) {
      response.writeHead(403).end("Unknown upload URL");
      return;
    }
    this.pendingFiles.delete(fileId);
    this.uploads.push({
      fileId,
      filename,
      bytes,
      contentType: request.headers["content-type"]
    });
    response.writeHead(200).end();
  }

  private createFile(body: unknown, response: ServerResponse): void {
    const filename = readString(body, "filename");
    if (filename === undefined) {
      this.sendError(response, 400, "invalid_argument", "filename is required");
      return;
    }
    const fileId = `file-${randomUUID()}`;
    this.pendingFiles.set(fileId, filename);
    this.sendOk(response, {
      file: {
        id: fileId,
        filename,
        status: "pending",
        created_at: String(Math.floor(Date.now() / 1000))
      },
      upload_url: `${this.url}/upload/${fileId}`,
      upload_expires_at: String(Math.floor(Date.now() / 1000) + 180)
    });
  }

  private createTask(body: unknown, response: ServerResponse): void {
    const invalid = this.validateTask(body);
    if (invalid !== undefined) {
      this.sendError(response, 400, "invalid_argument", invalid);
      return;
    }
    this.taskCounter += 1;
    const taskId = `task_${this.taskCounter}`;
    this.tasks.set(taskId, { status: "running", events: [] });
    this.sendOk(response, {
      task_id: taskId,
      task_title: readString(body, "title") ?? "Untitled",
      task_url: this.taskUrl(taskId),
      share_visibility: "private"
    });
  }

  private validateTask(body: unknown): string | undefined {
    const message = isRecord(body) ? body.message : undefined;
    if (!isRecord(message) || !Array.isArray(message.content)) {
      return "message.content is required";
    }
    for (const part of message.content as unknown[]) {
      if (!isRecord(part) || part.type !== "file") continue;
      if (!this.uploads.some((upload) => upload.fileId === part.file_id)) {
        return `file ${String(part.file_id)} has not been uploaded`;
      }
    }
    const connectors: unknown = message.connectors ?? [];
    if (!Array.isArray(connectors))
      return "message.connectors must be an array";
    for (const id of connectors) {
      if (!this.connectors.some((connector) => connector.id === id)) {
        return `connector ${String(id)} is not installed`;
      }
    }
    const schema = isRecord(body) ? body.structured_output_schema : undefined;
    if (schema === undefined) return undefined;
    if (!isRecord(schema) || schema.type !== "object") {
      return "structured_output_schema: root must be an object schema";
    }
    const schemaError = checkSchema(schema, "");
    return schemaError === undefined
      ? undefined
      : `structured_output_schema: ${schemaError}`;
  }

  private taskDetail(query: URLSearchParams, response: ServerResponse): void {
    const taskId = query.get("task_id") ?? "";
    const task = this.tasks.get(taskId);
    if (task === undefined) {
      this.sendError(response, 404, "not_found", `task ${taskId} not found`);
      return;
    }
    this.sendOk(response, {
      task: {
        id: taskId,
        status: task.status,
        created_at: 1893456000,
        updated_at: 1893456060,
        task_type: "standard",
        share_visibility: "private",
        title: "Instagram Reel",
        task_url: this.taskUrl(taskId),
        ...(task.has_running_background_jobs === undefined
          ? {}
          : { has_running_background_jobs: task.has_running_background_jobs })
      }
    });
  }

  private listMessages(query: URLSearchParams, response: ServerResponse): void {
    const taskId = query.get("task_id") ?? "";
    const task = this.tasks.get(taskId);
    if (task === undefined) {
      this.sendError(response, 404, "not_found", `task ${taskId} not found`);
      return;
    }
    const limit = Number(query.get("limit") ?? "50");
    const chronological = task.events.map((event, index) => ({
      id: `${taskId}-event-${index + 1}`,
      timestamp: 1893456000000 + index * 1000,
      ...event
    }));
    const ordered =
      query.get("order") === "asc"
        ? chronological
        : chronological.slice().reverse();
    this.sendOk(response, {
      task_id: taskId,
      messages: ordered.slice(0, limit),
      has_more: ordered.length > limit
    });
  }

  private sendOk(response: ServerResponse, body: Record<string, unknown>) {
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ ok: true, request_id: randomUUID(), ...body }));
  }

  private sendError(
    response: ServerResponse,
    status: number,
    code: string,
    message: string
  ): void {
    response.writeHead(status, { "content-type": "application/json" }).end(
      JSON.stringify({
        ok: false,
        request_id: randomUUID(),
        error: { code, message }
      })
    );
  }
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(body: unknown, key: string): string | undefined {
  const value = isRecord(body) ? body[key] : undefined;
  return typeof value === "string" ? value : undefined;
}

const schemaKeywords = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "description",
  "anyOf",
  "$ref",
  "$defs"
]);

function checkSchema(schema: unknown, path: string): string | undefined {
  const at = path === "" ? "." : path;
  if (!isRecord(schema)) return `${at}: not a valid JSON Schema`;
  const unsupported = Object.keys(schema).find(
    (key) => !schemaKeywords.has(key)
  );
  if (unsupported !== undefined) {
    return `${at}: unsupported keyword "${unsupported}"`;
  }
  if (schema.type === undefined && schema.anyOf === undefined) {
    return `${at}: must have a "type" field`;
  }
  if (schema.type === "object") {
    if (schema.additionalProperties !== false) {
      return `${at}: "additionalProperties" must be set to false`;
    }
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (!Object.keys(properties).every((key) => required.includes(key))) {
      return `${at}: "required" must include all properties`;
    }
    for (const [key, value] of Object.entries(properties)) {
      const error = checkSchema(value, `${path}.${key}`);
      if (error !== undefined) return error;
    }
  }
  if (schema.type === "array") {
    return checkSchema(schema.items, `${path}[]`);
  }
  return undefined;
}
