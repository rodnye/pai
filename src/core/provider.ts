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

/** Per-provider browser context settings (applied to every profile of the provider). */
export interface BrowserOptions {
  /** navigator.language / Accept-Language, e.g. "en-US". Useful when selectors rely on UI text. */
  readonly locale?: string;
}

export interface Provider {
  readonly id: string;
  readonly displayName: string;
  /** Page opened by `pnpm auth <id>` so the user can sign in / configure the account. */
  readonly loginUrl: string;
  /** Known model variants (`<id>/<variant>`). Empty = free-form, handled by `ChatPage.selectModel`. */
  readonly variants: readonly string[];
  readonly browser: BrowserOptions;
  readonly createChatCompletion: CreateChatCompletion;
}

export interface ProviderDefinition {
  /** Must match the folder name, e.g. "deepseek". */
  readonly id: string;
  readonly displayName: string;
  readonly loginUrl: string;
  readonly createPage: (page: Page, env: PageEnv) => ChatPage;
  /**
   * Closed list of variants. When set, unknown variants are rejected with a 400 before any browser
   * is launched, and they are listed by `GET /v1/models`.
   */
  readonly variants?: readonly string[];
  readonly browser?: BrowserOptions;
  /** Adjusts the global page timings for this provider (evaluated per request, after `.env` loads). */
  readonly pageEnv?: (base: PageEnv) => PageEnv;
}

export function defineProvider(definition: ProviderDefinition): Provider {
  return {
    id: definition.id,
    displayName: definition.displayName,
    loginUrl: definition.loginUrl,
    variants: definition.variants ?? [],
    browser: definition.browser ?? {},
    createChatCompletion: (request, options = {}) =>
      runCompletion(definition, getRuntime(), request, options),
  };
}
