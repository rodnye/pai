#!/usr/bin/env node
import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import { DEFAULT_ACCOUNT } from "./core/browser/profile-manager.js";
import { discoverProviders } from "./core/registry.js";
import { getRuntime } from "./core/runtime.js";
import { startServer } from "./server.js";

try {
  process.loadEnvFile(); // optional .env
} catch {
  // no .env file: rely on the real environment
}

const HELP = `pai - OpenAI-compatible gateway for AI chat web UIs

Usage:
  pnpm start | pnpm serve                       Start the OpenAI-compatible server
  pnpm auth <provider> [--account <name>]       Open a visible browser to prepare a session
  pnpm providers                                List providers and their accounts

Examples:
  pnpm auth stupid-1
  pnpm auth deepseek --account work
  pnpm auth deepseek
`;

async function serve(): Promise<void> {
  const runtime = getRuntime();
  const { config, logger, profiles } = runtime;
  const registry = await discoverProviders(logger);

  if (registry.list().length === 0)
    throw new Error("No providers found in src/providers/.");
  if (
    !config.apiKey &&
    !["127.0.0.1", "localhost", "::1"].includes(config.host)
  ) {
    logger.warn(
      "The server is reachable from the network and PAI_API_KEY is not set.",
    );
  }

  const server = await startServer({ config, logger, registry, profiles });
  logger.info(
    `pai listening on http://${config.host}:${config.port}/v1 ` +
      `(providers: ${registry
        .list()
        .map((provider) => provider.id)
        .join(", ")})`,
  );

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    logger.info(`${signal} received, shutting down...`);
    server.close();
    server.closeAllConnections();
    await profiles.closeAll();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

async function auth(
  providerId: string | undefined,
  account: string,
): Promise<void> {
  if (!providerId)
    throw new Error("Usage: pnpm auth <provider> [--account <name>]");

  const { logger, profiles } = getRuntime();
  const provider = (await discoverProviders(logger)).require(providerId);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log(`Opening ${provider.displayName} with profile '${account}':`);
    console.log(`  ${profiles.userDir(provider.id, account)}\n`);
    await profiles.authenticate(
      provider.id,
      account,
      provider.loginUrl,
      async () => {
        await rl.question(
          "Sign in / configure the account in the browser, then press ENTER here to save... ",
        );
      },
      provider.browser,
    );
    console.log("Profile saved (cookies, localStorage, IndexedDB).");
    console.log(
      "If the server is running, restart it or wait for its idle timeout to pick up the new session.",
    );
  } finally {
    rl.close();
  }
}

async function list(): Promise<void> {
  const { logger, profiles } = getRuntime();
  const registry = await discoverProviders(logger);
  for (const provider of registry.list()) {
    const accounts = await profiles.listAccounts(provider.id);
    const variants = provider.variants.length
      ? `  variants: ${provider.variants.join(", ")}`
      : "";
    console.log(
      `${provider.id}  ${provider.displayName}  accounts: ${accounts.join(", ")}${variants}`,
    );
  }
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      account: { type: "string", short: "a" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command = "help", ...rest] = positionals;

  if (values.help || command === "help") {
    console.log(HELP);
    return;
  }

  switch (command) {
    case "serve":
      return serve();
    case "auth":
      return auth(rest[0], values.account ?? DEFAULT_ACCOUNT);
    case "list":
      return list();
    default:
      console.error(`Unknown command '${command}'.\n\n${HELP}`);
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
