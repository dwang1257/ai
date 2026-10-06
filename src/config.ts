import { homedir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import { z } from "zod";

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

const expandHome = (path: string) =>
  path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;

const envSchema = z.object({
  MANUS_API_KEY: optional(z.string({ error: "MANUS_API_KEY is required" })),
  MANUS_INSTAGRAM_CONNECTOR: optional(z.string().default("Instagram")),
  ANTHROPIC_API_KEY: optional(z.string().optional()),
  RESEARCH_DIR: optional(
    z
      .string()
      .default("~/Movies/reel-research")
      .transform(expandHome)
      .refine(isAbsolute, {
        error: "RESEARCH_DIR must be an absolute path, ~/ is allowed"
      })
      .transform(normalize)
  ),
  YTDLP_PATH: optional(z.string().default("yt-dlp")),
  YTDLP_COOKIES_FROM_BROWSER: optional(z.string().optional()),
  UI_PORT: optional(
    z.coerce
      .number({ error: "UI_PORT must be a port number" })
      .int()
      .min(1)
      .max(65535)
      .default(3000)
  )
});

export interface Config {
  apiKey: string;
  instagramConnector: string;
  anthropicApiKey?: string;
  researchDir: string;
  ytdlpPath: string;
  ytdlpCookiesFromBrowser?: string;
  uiPort: number;
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
    ...(parsed.data.ANTHROPIC_API_KEY && {
      anthropicApiKey: parsed.data.ANTHROPIC_API_KEY
    }),
    ...(parsed.data.YTDLP_COOKIES_FROM_BROWSER && {
      ytdlpCookiesFromBrowser: parsed.data.YTDLP_COOKIES_FROM_BROWSER
    })
  };
}
