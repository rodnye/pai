import type { ChatSelectors } from "../../core/page-objects/base-chat-page.js";

/** PLACEHOLDER selectors: replace them with the real ones of the site you are scraping. */
export const IA2_SELECTORS: ChatSelectors = {
  input: "textarea#chat-input",
  assistantMessage: "div.message.assistant",
  newChatButton: "a[data-testid='new-chat-button']",
  busyIndicator: "button[aria-label='Stop generating']",
};
