import path from "node:path";
import { ProfileManager } from "./browser/profile-manager.js";
import { loadConfig, type Config } from "./config.js";
import { SessionStore } from "./conversation/session-store.js";
import { createLogger, type Logger } from "./logger.js";

/** Shared services every provider needs. Created lazily so provider modules stay import-safe. */
export interface Runtime {
  readonly config: Config;
  readonly logger: Logger;
  readonly profiles: ProfileManager;
  readonly sessions: SessionStore;
}

export function createRuntime(config: Config = loadConfig()): Runtime {
  const logger = createLogger(config.logLevel);
  return {
    config,
    logger,
    profiles: new ProfileManager(config, logger),
    sessions: new SessionStore(
      path.join(config.dataDir, "sessions.json"),
      { ttlMs: config.sessionTtlMs },
      logger.child("sessions"),
    ),
  };
}

let instance: Runtime | undefined;

export function getRuntime(): Runtime {
  instance ??= createRuntime();
  return instance;
}

/** Test seam / programmatic embedding. */
export function setRuntime(runtime: Runtime): void {
  instance = runtime;
}
