import { homedir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import { z } from "zod";
import { resolutions } from "./animate.js";
import type { Resolution } from "./animate.js";

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

const expandHome = (path: string) =>
  path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;

const absoluteDir = (name: string, fallback: string) =>
  optional(
    z
      .string()
      .default(fallback)
      .transform(expandHome)
      .refine(isAbsolute, {
        error: `${name} must be an absolute path, ~/ is allowed`
      })
      .transform(normalize)
  );

const envSchema = z.object({
  MANUS_API_KEY: optional(z.string({ error: "MANUS_API_KEY is required" })),
  MANUS_INSTAGRAM_CONNECTOR: optional(z.string().default("Instagram")),
  ANTHROPIC_API_KEY: optional(z.string().optional()),
  RESEARCH_DIR: absoluteDir("RESEARCH_DIR", "~/Movies/reel-research"),
  YTDLP_PATH: optional(z.string().default("yt-dlp")),
  YTDLP_COOKIES_FROM_BROWSER: optional(z.string().optional()),
  UI_PORT: optional(
    z.coerce
      .number({ error: "UI_PORT must be a port number" })
      .int()
      .min(1)
      .max(65535)
      .default(3000)
  ),
  MAESTRO_URL: optional(
    z
      .url({
        protocol: /^https?$/,
        error: "MAESTRO_URL must be an http or https URL"
      })
      .optional()
  ),
  MAESTRO_OUTPUT_DIR: absoluteDir("MAESTRO_OUTPUT_DIR", "~/Movies/maestro"),
  MAESTRO_RESOLUTION: optional(
    z
      .enum(resolutions, {
        error: `MAESTRO_RESOLUTION must be one of ${resolutions.join(", ")}`
      })
      .default("auto_720p")
  ),
  MAESTRO_WORKSPACE: optional(z.string().optional())
});

export interface Config {
  apiKey: string;
  instagramConnector: string;
  anthropicApiKey?: string;
  researchDir: string;
  ytdlpPath: string;
  ytdlpCookiesFromBrowser?: string;
  uiPort: number;
  maestroUrl?: string;
  maestroOutputDir: string;
  maestroResolution: Resolution;
  maestroWorkspace?: string;
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
    instagramConnector: parsed.data.MANUS_INSTAGRAM_CONNECTOR,
    researchDir: parsed.data.RESEARCH_DIR,
    ytdlpPath: parsed.data.YTDLP_PATH,
    uiPort: parsed.data.UI_PORT,
    maestroOutputDir: parsed.data.MAESTRO_OUTPUT_DIR,
    maestroResolution: parsed.data.MAESTRO_RESOLUTION,
    ...(parsed.data.ANTHROPIC_API_KEY && {
      anthropicApiKey: parsed.data.ANTHROPIC_API_KEY
    }),
    ...(parsed.data.YTDLP_COOKIES_FROM_BROWSER && {
      ytdlpCookiesFromBrowser: parsed.data.YTDLP_COOKIES_FROM_BROWSER
    }),
    ...(parsed.data.MAESTRO_URL && { maestroUrl: parsed.data.MAESTRO_URL }),
    ...(parsed.data.MAESTRO_WORKSPACE && {
      maestroWorkspace: parsed.data.MAESTRO_WORKSPACE
    })
  };
}
