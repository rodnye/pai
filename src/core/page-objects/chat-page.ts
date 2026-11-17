import type { Config } from "../config.js";

export type PageEnv = Pick<
  Config,
  | "responseTimeoutMs"
  | "navigationTimeoutMs"
  | "stableMs"
  | "pollMs"
  | "typeDelay"
  | "sendDelay"
  | "typeMaxChars"
  | "keyDelay"
>;

/** What the conversation runner needs from any provider's page object. */
export interface ChatPage {
  /** Opens a blank conversation (navigates to the base URL and clicks "New chat" if present). */
  startNewChat(): Promise<void>;
  /** Opens an existing provider chat. Resolves `false` if it cannot be opened (deleted, redirected, ...). */
  openSession(sessionId: string): Promise<boolean>;
  /** The provider's id for the chat currently open, if the site exposes one (usually in the URL). */
  resolveSessionId(): Promise<string | undefined>;
  /** Text of the newest assistant bubble currently on screen, used to validate a resumed chat. */
  readLastAssistantMessage(): Promise<string | undefined>;
  /** Optional provider-specific model picker (`ia-2/<variant>`). */
  selectModel(variant: string): Promise<void>;
  /** Types the prompt, presses Enter and resolves with the final answer text. */
  sendMessage(text: string): Promise<string>;
}
