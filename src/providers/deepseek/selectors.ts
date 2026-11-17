import type { ChatSelectors } from "../../core/page-objects/base-chat-page.js";

/**
 * They anchor on `ds-*` classes, placeholders,
 * hrefs and aria-labels; hashed build classes (`_27c9245`, ...) are deliberately avoided.
 * Text-based ones assume the English UI (the provider forces the `en-US` browser locale).
 */
export const DEEPSEEK_SELECTORS = {
  // Do not use name="search": it is misleading. Do not read the autosize mirror div either.
  input: 'textarea[placeholder="Message DeepSeek"]',
  // Final answer only (excludes the DeepThink reasoning).
  assistantMessage: ".ds-assistant-message-main-content",
  newChatButton: ':text-is("New chat")',
  // The only primary circle button of the composer: send arrow / stop square.
  sendButton: ".ds-button--primary.ds-button--circle",
} as const satisfies ChatSelectors;

/** Extra selectors used by the DeepSeek page object (not part of the generic contract). */
export const DEEPSEEK_DOM = {
  message: ".ds-message",
  userText: ".ds-collapsible-text",
  answer: ".ds-assistant-message-main-content",
  thinking: ".ds-think-content",
  /** Only finished answers have the action bar with "Read aloud". */
  finishedMarker: '[aria-label="Read aloud"]',
  disabledClass: "ds-button--disabled",
  /** `d` attribute prefix of the stop (rounded square) icon shown while generating. */
  stopIconPathPrefix: "M2 4.88C2 3.68",
  toggle: ".ds-toggle-button",
  notification: ".ds-notification-container",
  challenge: "#cf-turnstile, #cf-overlay",
} as const;
