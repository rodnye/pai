import { BaseChatPage } from "../../../core/page-objects/base-chat-page.js";
import { IA2_SELECTORS } from "../selectors.js";

const BASE_URL = "https://ia-2.example.com/"; // PLACEHOLDER

/**
 * ia-2 exposes chats as https://ia-2.example.com/chat/<sessionId>, which makes them resumable:
 * the id is read from the URL after the first message and later used to reopen the chat.
 */
export class Ia2ChatPage extends BaseChatPage {
  protected readonly baseUrl = BASE_URL;
  protected readonly selectors = IA2_SELECTORS;

  protected override sessionUrl(sessionId: string): string {
    return new URL(
      `/chat/${encodeURIComponent(sessionId)}`,
      BASE_URL,
    ).toString();
  }

  protected override parseSessionId(url: string): string | undefined {
    return /^\/chat\/([\w-]+)\/?$/.exec(new URL(url).pathname)?.[1];
  }
}
