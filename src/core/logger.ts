export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99,
};

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export function createLogger(level: LogLevel, scope = "pai"): Logger {
  const threshold = WEIGHT[level];

  const emit = (
    severity: Exclude<LogLevel, "silent">,
    message: string,
    meta?: Record<string, unknown>,
  ): void => {
    if (WEIGHT[severity] < threshold) return;
    const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
    const line = `${new Date().toISOString()} ${severity.toUpperCase().padEnd(5)} [${scope}] ${message}${suffix}`;
    if (severity === "error" || severity === "warn") console.error(line);
    else console.log(line);
  };

  return {
    debug: (message, meta) => emit("debug", message, meta),
    info: (message, meta) => emit("info", message, meta),
    warn: (message, meta) => emit("warn", message, meta),
    error: (message, meta) => emit("error", message, meta),
    child: (childScope) => createLogger(level, `${scope}:${childScope}`),
  };
}
