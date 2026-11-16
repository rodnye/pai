import path from "node:path";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const envSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PAI_API_KEY: z.string().min(1).optional(),
  PAI_DATA_DIR: z.string().default(".pai"),
  PAI_HEADLESS: booleanString.prefault("true"),
  PAI_BROWSER_CHANNEL: z.string().min(1).optional(),
  PAI_CONTEXT_IDLE_MS: z.coerce.number().int().positive().default(300_000),
  PAI_RESPONSE_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  PAI_NAVIGATION_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  PAI_STABLE_MS: z.coerce.number().int().positive().default(1_500),
  PAI_POLL_MS: z.coerce.number().int().positive().default(250),
  PAI_MAX_HISTORY_CHARS: z.coerce.number().int().positive().default(60_000),
  PAI_SESSION_TTL_HOURS: z.coerce.number().positive().default(168),
  PAI_LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error", "silent"])
    .default("info"),
});

export interface Config {
  readonly host: string;
  readonly port: number;
  readonly apiKey: string | undefined;
  readonly dataDir: string;
  readonly headless: boolean;
  readonly browserChannel: string | undefined;
  readonly contextIdleMs: number;
  readonly responseTimeoutMs: number;
  readonly navigationTimeoutMs: number;
  readonly stableMs: number;
  readonly pollMs: number;
  readonly maxHistoryChars: number;
  readonly sessionTtlMs: number;
  readonly logLevel: "debug" | "info" | "warn" | "error" | "silent";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty variables (e.g. "PAI_API_KEY=" in .env) as unset.
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(
      ([, value]) => value !== undefined && value !== "",
    ),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${details}`);
  }

  const e = parsed.data;
  return {
    host: e.HOST,
    port: e.PORT,
    apiKey: e.PAI_API_KEY,
    dataDir: path.resolve(e.PAI_DATA_DIR),
    headless: e.PAI_HEADLESS,
    browserChannel: e.PAI_BROWSER_CHANNEL,
    contextIdleMs: e.PAI_CONTEXT_IDLE_MS,
    responseTimeoutMs: e.PAI_RESPONSE_TIMEOUT_MS,
    navigationTimeoutMs: e.PAI_NAVIGATION_TIMEOUT_MS,
    stableMs: e.PAI_STABLE_MS,
    pollMs: e.PAI_POLL_MS,
    maxHistoryChars: e.PAI_MAX_HISTORY_CHARS,
    sessionTtlMs: e.PAI_SESSION_TTL_HOURS * 3_600_000,
    logLevel: e.PAI_LOG_LEVEL,
  };
}
