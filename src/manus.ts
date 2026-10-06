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

const baseUrl = "https://api.manus.ai";

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

export type StructuredOutput = Extract<
  TaskEvent,
  { type: "structured_output_result" }
>["structured_output_result"];

export interface TaskFile {
  id: string;
  filename: string;
  mimeType: string;
}

export interface CreateTaskRequest {
  title: string;
  prompt: string;
  file?: TaskFile;
  connectorIds?: string[];
  outputSchema: Record<string, unknown>;
}

export type TaskOutcome =
  | { state: "running" }
  | { state: "needs_attention"; message: string }
  | { state: "failed"; message: string }
  | { state: "finished"; output: StructuredOutput | undefined };

export type TaskCheck = { taskId: string; taskUrl: string } & TaskOutcome;

export class ManusClient {
  constructor(private readonly apiKey: string) {}

  async listConnectors(): Promise<Connector[]> {
    const body = await this.call("GET", "connector.list");
    return this.parse(connectorListSchema, body).data;
  }

  async uploadFile(filename: string, content: Blob): Promise<string> {
    const { file, upload_url } = this.parse(
      fileUploadSchema,
      await this.call("POST", "file.upload", { filename })
    );
    const response = await fetch(upload_url, {
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
          ...(request.file === undefined
            ? []
            : [
                {
                  type: "file",
                  file_id: request.file.id,
                  filename: request.file.filename,
                  mime_type: request.file.mimeType
                }
              ])
        ],
        ...(request.connectorIds === undefined
          ? {}
          : { connectors: request.connectorIds })
      },
      structured_output_schema: request.outputSchema
    });
    const task = this.parse(taskCreateSchema, body);
    return { taskId: task.task_id, taskUrl: task.task_url };
  }

  private async getTask(taskId: string): Promise<Task> {
    const body = await this.call(
      "GET",
      `task.detail?${new URLSearchParams({ task_id: taskId }).toString()}`
    );
    return this.parse(taskDetailSchema, body).task;
  }

  async checkTask(taskId: string): Promise<TaskCheck> {
    const [task, events] = await Promise.all([
      this.getTask(taskId),
      this.listRecentEvents(taskId)
    ]);
    return {
      taskId: task.id,
      taskUrl: task.task_url,
      ...outcome(task, events)
    };
  }

  private async listRecentEvents(taskId: string): Promise<TaskEvent[]> {
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
    const response = await fetch(new URL(`/v2/${path}`, baseUrl), {
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

function outcome(task: Task, events: TaskEvent[]): TaskOutcome {
  switch (task.status) {
    case "running":
      return { state: "running" };
    case "waiting":
      return {
        state: "needs_attention",
        message:
          waitingDescription(events) ??
          "Manus is waiting for input. Open the task to respond."
      };
    case "error":
      return {
        state: "failed",
        message: latestError(events) ?? "The Manus task failed."
      };
    case "stopped":
      if (task.has_running_background_jobs === true) {
        return { state: "running" };
      }
      return { state: "finished", output: structuredOutput(events) };
  }
}

function waitingDescription(events: TaskEvent[]): string | undefined {
  for (const event of events) {
    if (event.type === "status_update") {
      return event.status_update.status_detail?.waiting_description;
    }
  }
  return undefined;
}

function latestError(events: TaskEvent[]): string | undefined {
  for (const event of events) {
    if (event.type === "error_message") return event.error_message.content;
  }
  return undefined;
}

function structuredOutput(events: TaskEvent[]): StructuredOutput | undefined {
  for (const event of events) {
    if (event.type === "structured_output_result") {
      return event.structured_output_result;
    }
  }
  return undefined;
}
