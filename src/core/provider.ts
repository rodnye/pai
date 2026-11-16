import { runCompletion } from "./chat/run-completion.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "./openai/schema.js";
import type { ChatPage, PageEnv } from "./page-objects/chat-page.js";
import { getRuntime } from "./runtime.js";
import type { Page } from "playwright";

/**
 * fresh     - new chat, single message
 * resumed   - continued a cached provider chat (only the last message was sent)
 * restored  - new chat primed with the history through a continuation prompt
 */
export type CompletionMode = "fresh" | "resumed" | "restored";

export interface CompletionMeta {
  readonly provider: string;
  readonly account: string;
  readonly sessionId: string | undefined;
  readonly mode: CompletionMode;
}

export interface CompletionOptions {
  /** Pin a specific account (userDir). Otherwise the least busy / session-owning one is used. */
  account?: string | undefined;
  /** Provider-specific model variant, forwarded to `ChatPage.selectModel`. */
  variant?: string | undefined;
  /** Debug/telemetry hook, called once the completion succeeded. */
  onMeta?: (meta: CompletionMeta) => void;
}

/** The OpenAI-compatible function every provider folder exposes. */
export type CreateChatCompletion = (
  request: ChatCompletionRequest,
  options?: CompletionOptions,
) => Promise<ChatCompletionResponse>;

export interface Provider {
  readonly id: string;
  readonly displayName: string;
  /** Page opened by `pnpm auth <id>` so the user can sign in / configure the account. */
  readonly loginUrl: string;
  readonly createChatCompletion: CreateChatCompletion;
}

export interface ProviderDefinition {
  /** Must match the folder name, e.g. "ia-1". */
  readonly id: string;
  readonly displayName: string;
  readonly loginUrl: string;
  /**
   * stateless: every request opens a new chat (history is replayed when present).
   * resumable: provider chat ids are cached and reused, with automatic fallback to a replay.
   */
  readonly sessionStrategy: "stateless" | "resumable";
  readonly createPage: (page: Page, env: PageEnv) => ChatPage;
}

export function defineProvider(definition: ProviderDefinition): Provider {
  return {
    id: definition.id,
    displayName: definition.displayName,
    loginUrl: definition.loginUrl,
    createChatCompletion: (request, options = {}) =>
      runCompletion(definition, getRuntime(), request, options),
  };
}
