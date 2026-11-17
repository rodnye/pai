import { timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from "express";
import type { ZodError } from "zod";
import type { ProfileManager } from "./core/browser/profile-manager.js";
import type { Config } from "./core/config.js";
import {
  BadRequestError,
  PaiError,
  UnauthorizedError,
  normalizeError,
  toErrorBody,
} from "./core/errors.js";
import type { Logger } from "./core/logger.js";
import { buildChunk, chunkText } from "./core/openai/response.js";
import { chatCompletionRequestSchema } from "./core/openai/schema.js";
import type { CompletionMeta, CompletionOptions } from "./core/provider.js";
import type { ProviderRegistry } from "./core/registry.js";

export interface ServerDeps {
  readonly config: Config;
  readonly logger: Logger;
  readonly registry: ProviderRegistry;
  readonly profiles: ProfileManager;
}

const formatZodError = (error: ZodError): string =>
  error.issues
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ");

function requireApiKey(apiKey: string | undefined): RequestHandler {
  if (!apiKey) return (_req, _res, next) => next();
  const expected = Buffer.from(apiKey);

  return (req, _res, next) => {
    const provided = Buffer.from(
      (req.header("authorization") ?? "").replace(/^Bearer\s+/i, ""),
    );
    const valid =
      provided.length === expected.length &&
      timingSafeEqual(provided, expected);
    next(valid ? undefined : new UnauthorizedError());
  };
}

export function createApp(deps: ServerDeps): Express {
  const { config, logger, registry, profiles } = deps;
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "10mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      providers: registry.list().map((provider) => provider.id),
    });
  });

  app.use("/v1", requireApiKey(config.apiKey));

  app.get("/v1/models", async (_req, res) => {
    const created = Math.floor(Date.now() / 1000);
    const entry = (id: string) => ({
      id,
      object: "model",
      created,
      owned_by: "pai",
    });
    const data: ReturnType<typeof entry>[] = [];

    const models = registry.listModels();
    for (const provider of registry.list()) {
      const own = models.filter((model) => model.provider === provider);
      for (const model of own) data.push(entry(model.id));
      const accounts = await profiles.listAccounts(provider.id);
      if (accounts.length > 1) {
        for (const account of accounts)
          for (const model of own) data.push(entry(`${model.id}@${account}`));
      }
    }
    res.json({ object: "list", data });
  });

  app.post("/v1/chat/completions", async (req, res) => {
    const parsed = chatCompletionRequestSchema.safeParse(req.body);
    if (!parsed.success)
      throw new BadRequestError(
        formatZodError(parsed.error),
        "invalid_request_body",
      );

    const request = parsed.data;
    const { provider, ref } = registry.resolve(request.model);

    const holder: { meta?: CompletionMeta } = {};
    const options: CompletionOptions = {
      account: ref.account,
      variant: ref.variant,
      onMeta: (meta) => {
        holder.meta = meta;
      },
    };

    if (!request.stream) {
      const completion = await provider.createChatCompletion(request, options);
      if (holder.meta) {
        res.setHeader("x-pai-account", holder.meta.account);
        res.setHeader("x-pai-session-mode", holder.meta.mode);
        if (holder.meta.sessionId)
          res.setHeader("x-pai-session-id", holder.meta.sessionId);
      }
      res.json(completion);
      return;
    }

    // Web chats cannot stream token by token reliably, so the finished answer is replayed as SSE.
    // Headers go out immediately and a comment keeps proxies/clients from timing out meanwhile.
    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
    res.on("close", () => clearInterval(keepAlive));

    const send = (payload: unknown): void => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const completion = await provider.createChatCompletion(request, options);
      const content = completion.choices[0]?.message.content ?? "";
      send(buildChunk(completion, { role: "assistant" }, null));
      for (const piece of chunkText(content, 48))
        send(buildChunk(completion, { content: piece }, null));
      send(buildChunk(completion, {}, "stop"));
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error(`Streaming completion failed: ${normalized.message}`);
      send(toErrorBody(normalized));
    } finally {
      clearInterval(keepAlive);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  });

  app.use(() => {
    throw new PaiError(
      "Route not found.",
      404,
      "invalid_request_error",
      "not_found",
    );
  });

  const errorHandler: ErrorRequestHandler = (
    error: unknown,
    _req,
    res,
    next,
  ) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const normalized = normalizeError(error);
    if (normalized.status >= 500)
      logger.error(normalized.message, {
        cause: String(normalized.cause ?? ""),
      });
    res.status(normalized.status).json(toErrorBody(normalized));
  };
  app.use(errorHandler);

  return app;
}

export function startServer(deps: ServerDeps): Promise<Server> {
  const app = createApp(deps);
  return new Promise((resolve, reject) => {
    const server = app.listen(deps.config.port, deps.config.host, () =>
      resolve(server),
    );
    server.once("error", reject);
  });
}
