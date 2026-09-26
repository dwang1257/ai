import { z } from "zod";

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

const envSchema = z.object({
  MANUS_API_KEY: optional(z.string({ error: "MANUS_API_KEY is required" })),
  MANUS_BASE_URL: optional(z.url().default("https://api.manus.ai")),
  MANUS_INSTAGRAM_CONNECTOR: optional(z.string().default("Instagram"))
});

export interface Config {
  apiKey: string;
  baseUrl: string;
  instagramConnector: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid configuration: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`
    );
  }
  return {
    apiKey: parsed.data.MANUS_API_KEY,
    baseUrl: parsed.data.MANUS_BASE_URL,
    instagramConnector: parsed.data.MANUS_INSTAGRAM_CONNECTOR
  };
}
