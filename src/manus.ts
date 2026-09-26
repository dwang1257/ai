import { z } from "zod";

export class ManusError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "ManusError";
  }
}

const errorSchema = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() })
});

const connectorListSchema = z.object({
  data: z.array(z.object({ id: z.string(), name: z.string() })).default([])
});

const fileUploadSchema = z.object({
  file: z.object({ id: z.string() }),
  upload_url: z.url()
});

const taskCreateSchema = z.object({
  task_id: z.string(),
  task_url: z.string()
});

const taskDetailSchema = z.object({
  task: z.object({
    id: z.string(),
    status: z.enum(["running", "stopped", "waiting", "error"]),
    task_url: z.string(),
    has_running_background_jobs: z.boolean().optional()
  })
});

const eventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status_update"),
    status_update: z.object({
      agent_status: z.string(),
      status_detail: z
        .object({ waiting_description: z.string().optional() })
        .optional()
    })
  }),
  z.object({
    type: z.literal("structured_output_result"),
    structured_output_result: z.object({
      success: z.boolean(),
      value: z.unknown(),
      error: z.string().nullable().optional()
    })
  }),
  z.object({
    type: z.literal("error_message"),
    error_message: z.object({ content: z.string() })
  })
]);

const listMessagesSchema = z.object({
  messages: z.array(z.looseObject({ type: z.string() }))
});

export type Connector = z.infer<typeof connectorListSchema>["data"][number];
export type Task = z.infer<typeof taskDetailSchema>["task"];
export type TaskEvent = z.infer<typeof eventSchema>;

export interface CreateTaskRequest {
  title: string;
  prompt: string;
  fileId: string;
  filename: string;
  connectorId: string;
  outputSchema: Record<string, unknown>;
}

export class ManusClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async listConnectors(): Promise<Connector[]> {
    const body = await this.call("GET", "connector.list");
    return this.parse(connectorListSchema, body).data;
  }

  async uploadFile(filename: string, content: Blob): Promise<string> {
    const { file, upload_url } = this.parse(
      fileUploadSchema,
      await this.call("POST", "file.upload", { filename })
    );
    const response = await this.fetchFn(upload_url, {
      method: "PUT",
      body: content,
      headers: { "content-type": content.type }
    });
    if (!response.ok) {
      throw new ManusError(
        "upload_failed",
        `Uploading ${filename} failed with HTTP ${response.status}`,
        response.status
      );
    }
    return file.id;
  }

  async createTask(
    request: CreateTaskRequest
  ): Promise<{ taskId: string; taskUrl: string }> {
    const body = await this.call("POST", "task.create", {
      title: request.title,
      interactive_mode: false,
      message: {
        content: [
          { type: "text", text: request.prompt },
          {
            type: "file",
            file_id: request.fileId,
            filename: request.filename,
            mime_type: "video/mp4"
          }
        ],
        connectors: [request.connectorId]
      },
      structured_output_schema: request.outputSchema
    });
    const task = this.parse(taskCreateSchema, body);
    return { taskId: task.task_id, taskUrl: task.task_url };
  }

  async getTask(taskId: string): Promise<Task> {
    const body = await this.call(
      "GET",
      `task.detail?${new URLSearchParams({ task_id: taskId }).toString()}`
    );
    return this.parse(taskDetailSchema, body).task;
  }

  async listRecentEvents(taskId: string): Promise<TaskEvent[]> {
    const query = new URLSearchParams({
      task_id: taskId,
      order: "desc",
      limit: "50"
    });
    const body = await this.call(
      "GET",
      `task.listMessages?${query.toString()}`
    );
    return this.parse(listMessagesSchema, body).messages.flatMap((message) => {
      const event = eventSchema.safeParse(message);
      return event.success ? [event.data] : [];
    });
  }

  private async call(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<unknown> {
    const response = await this.fetchFn(new URL(`/v2/${path}`, this.baseUrl), {
      method,
      headers: {
        "x-manus-api-key": this.apiKey,
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60_000)
    });
    const json: unknown = await response.json().catch(() => undefined);
    const error = errorSchema.safeParse(json);
    if (error.success) {
      throw new ManusError(
        error.data.error.code,
        error.data.error.message,
        response.status
      );
    }
    if (!response.ok) {
      throw new ManusError(
        "http_error",
        `Manus ${path.split("?")[0] ?? path} returned HTTP ${response.status}`,
        response.status
      );
    }
    return json;
  }

  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new ManusError(
        "unexpected_response",
        `Unexpected Manus response: ${z.prettifyError(parsed.error)}`
      );
    }
    return parsed.data;
  }
}
