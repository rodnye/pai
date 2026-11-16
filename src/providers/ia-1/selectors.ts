import type { ChatSelectors } from "../../core/page-objects/base-chat-page.js";

/** PLACEHOLDER selectors: replace them with the real ones of the site you are scraping. */
export const IA1_SELECTORS: ChatSelectors = {
  input: "textarea[data-testid='prompt-input']",
  assistantMessage: "div[data-role='assistant']",
  newChatButton: "button[data-testid='new-chat']",
  busyIndicator: "button[data-testid='stop-generating']",
};
