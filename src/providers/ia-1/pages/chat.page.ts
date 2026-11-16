import { BaseChatPage } from "../../../core/page-objects/base-chat-page.js";
import { IA1_SELECTORS } from "../selectors.js";

/** ia-1 has no addressable chats, so it only needs a base URL and selectors. */
export class Ia1ChatPage extends BaseChatPage {
  protected readonly baseUrl = "https://ia-1.example.com/"; // PLACEHOLDER
  protected readonly selectors = IA1_SELECTORS;
}
