import { errors as playwrightErrors } from "playwright";
import { fingerprintConversation } from "../conversation/fingerprint.js";
import {
  collapseWhitespace,
  normalizeMessages,
  splitConversation,
  type SplitConversation,
} from "../conversation/messages.js";
import {
  buildContinuationPrompt,
  buildFirstPrompt,
  type PromptLimits,
} from "../conversation/prompt-builder.js";
import type { SessionRecord } from "../conversation/session-store.js";
import {
  BadRequestError,
  PaiError,
  ProviderAutomationError,
  ProviderTimeoutError,
} from "../errors.js";
import type { Logger } from "../logger.js";
import { buildChatCompletion } from "../openai/response.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "../openai/schema.js";
import type { ChatPage } from "../page-objects/chat-page.js";
import type {
  CompletionMode,
  CompletionOptions,
  ProviderDefinition,
} from "../provider.js";
import type { Runtime } from "../runtime.js";

interface TurnResult {
  readonly reply: string;
  readonly mode: CompletionMode;
  readonly sessionId: string | undefined;
}

/**
 * Shared orchestration behind every provider's `createChatCompletion`:
 * pick account -> (resume cached chat | start new chat + replay history) -> send -> cache session.
 */
export async function runCompletion(
  definition: ProviderDefinition,
  runtime: Runtime,
  request: ChatCompletionRequest,
  options: CompletionOptions,
): Promise<ChatCompletionResponse> {
  const { config, logger, profiles, sessions } = runtime;
  const log = logger.child(definition.id);

  if (
    options.variant !== undefined &&
    definition.variants !== undefined &&
    !definition.variants.includes(options.variant)
  ) {
    throw new BadRequestError(
      `Unknown variant '${options.variant}' for '${definition.id}'. ` +
        `Available: ${definition.variants.join(", ") || "none"}.`,
      "model_not_found",
    );
  }
  const pageEnv = definition.pageEnv?.(config) ?? config;

  const turns = normalizeMessages(request.messages);
  const conversation = splitConversation(turns);
  const resumable = definition.sessionStrategy === "resumable";

  // A cached chat only helps if it lives in an account we are allowed to use.
  const hit =
    resumable && conversation.history.length > 0
      ? await sessions.find(
          definition.id,
          fingerprintConversation(conversation),
        )
      : undefined;
  const cached =
    hit && (!options.account || hit.accountId === options.account)
      ? hit
      : undefined;

  const account = await profiles.resolveAccount(definition.id, {
    pinned: options.account,
    preferred: cached?.accountId,
  });

  try {
    const result = await profiles.withPage(
      definition.id,
      account,
      (page) =>
        executeTurn({
          chat: definition.createPage(page, pageEnv),
          conversation,
          cached,
          variant: options.variant,
          limits: { maxHistoryChars: config.maxHistoryChars },
          resumable,
          log,
        }),
      definition.browser,
    );

    if (resumable) {
      if (result.sessionId) {
        await sessions.advance(cached, {
          providerId: definition.id,
          accountId: account,
          sessionId: result.sessionId,
          fingerprint: fingerprintConversation({
            system: conversation.system,
            history: [
              ...conversation.history,
              conversation.current,
              { role: "assistant", content: result.reply },
            ],
          }),
          updatedAt: Date.now(),
        });
      } else if (cached) {
        await sessions.forget(cached);
      }
    }

    options.onMeta?.({
      provider: definition.id,
      account,
      sessionId: result.sessionId,
      mode: result.mode,
    });
    log.info(`completion done`, {
      account,
      mode: result.mode,
      sessionId: result.sessionId,
    });

    return buildChatCompletion({
      model: request.model,
      content: result.reply,
      promptText: turns.map((turn) => turn.content).join("\n"),
    });
  } catch (error) {
    if (error instanceof PaiError) throw error;
    const message =
      error instanceof Error
        ? (error.message.split("\n")[0] ?? "")
        : String(error);
    if (error instanceof playwrightErrors.TimeoutError) {
      throw new ProviderTimeoutError(`${definition.displayName}: ${message}`, {
        cause: error,
      });
    }
    throw new ProviderAutomationError(
      `${definition.displayName} automation failed: ${message}`,
      {
        cause: error,
      },
    );
  }
}

async function executeTurn(input: {
  chat: ChatPage;
  conversation: SplitConversation;
  cached: SessionRecord | undefined;
  variant: string | undefined;
  limits: PromptLimits;
  resumable: boolean;
  log: Logger;
}): Promise<TurnResult> {
  const { chat, conversation, cached, variant, limits, resumable, log } = input;

  // 1) Fast path: continue the chat that already holds this exact history.
  if (cached) {
    const reopened = await chat.openSession(cached.sessionId);
    if (reopened && (await historyStillMatches(chat, conversation))) {
      const reply = await chat.sendMessage(conversation.current.content);
      return {
        reply,
        mode: "resumed",
        sessionId: await chat.resolveSessionId(),
      };
    }
    log.info(
      "Cached session is gone or was modified; replaying history in a new chat",
      {
        sessionId: cached.sessionId,
      },
    );
  }

  // 2) New chat. If there is history, replay it with a continuation prompt.
  await chat.startNewChat();
  if (variant) await chat.selectModel(variant);

  const hasHistory = conversation.history.length > 0;
  const prompt = hasHistory
    ? buildContinuationPrompt(
        {
          system: conversation.system,
          history: conversation.history,
          current: conversation.current.content,
        },
        limits,
      )
    : buildFirstPrompt(conversation.system, conversation.current.content);

  const reply = await chat.sendMessage(prompt);
  return {
    reply,
    mode: hasHistory ? "restored" : "fresh",
    sessionId: resumable ? await chat.resolveSessionId() : undefined,
  };
}

/**
 * Guards against chats that were edited or rolled back outside pai: the last assistant bubble on
 * screen must be the one we expect. A false negative only costs a history replay, never a wrong answer.
 */
async function historyStillMatches(
  chat: ChatPage,
  conversation: SplitConversation,
): Promise<boolean> {
  const expected = conversation.history.findLast(
    (turn) => turn.role === "assistant",
  );
  if (!expected) return true;
  const actual = await chat.readLastAssistantMessage();
  return (
    actual !== undefined &&
    collapseWhitespace(actual) === collapseWhitespace(expected.content)
  );
}
