import {
  BaseChatPage,
  type ChatSelectors,
} from "../../core/page-objects/base-chat-page.js";
import { defineProvider } from "../../core/provider.js";

export const stupid1Url = (pathname: string) =>
  new URL(
    pathname,
    process.env.PAI_STUPID1_BASE_URL || "http://127.0.0.1:4010",
  ).toString();

export const provider = defineProvider({
  id: "stupid-1",
  displayName: "Stupid non-AI for testings",
  loginUrl: stupid1Url("/login"),
  createPage: (page, env) => new Stupid1ChatPage(page, env),
});

export const createChatCompletion = provider.createChatCompletion;
export default provider;

export class Stupid1ChatPage extends BaseChatPage {
  protected readonly baseUrl = stupid1Url("/");
  protected readonly selectors: ChatSelectors = {
    input: "textarea[data-testid='prompt-input']",
    assistantMessage: "div[data-role='assistant']",
    newChatButton: "button[data-testid='new-chat']",
    busyIndicator: "button[data-testid='stop-generating']",
  };
}
