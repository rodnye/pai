import { BaseChatPage } from "../../../core/page-objects/base-chat-page.js";
import { ia1Url } from "../endpoints.js";
import { IA1_SELECTORS } from "../selectors.js";

/** ia-1 has no addressable chats, so it only needs a base URL and selectors. */
export class Ia1ChatPage extends BaseChatPage {
  protected readonly baseUrl = ia1Url("/");
  protected readonly selectors = IA1_SELECTORS;
}
