import { defineProvider } from "../../core/provider.js";
import { deepseekResponseTimeoutMs, deepseekUrl } from "./endpoints.js";
import { DeepseekChatPage } from "./pages/chat.page.js";
import { DEEPSEEK_VARIANTS } from "./variants.js";

export const provider = defineProvider({
  id: "deepseek",
  displayName: "DeepSeek (chat.deepseek.com)",
  loginUrl: deepseekUrl("/sign_in"),
  sessionStrategy: "resumable",
  variants: Object.keys(DEEPSEEK_VARIANTS),
  // Selectors rely on English UI text ("Message DeepSeek", "New chat", "Read aloud").
  browser: { locale: "en-US" },
  pageEnv: (base) => ({
    ...base,
    responseTimeoutMs: deepseekResponseTimeoutMs(base.responseTimeoutMs),
  }),
  createPage: (page, env) => new DeepseekChatPage(page, env),
});

/** OpenAI-compatible entry point: (ChatCompletionRequest) => Promise<ChatCompletionResponse>. */
export const createChatCompletion = provider.createChatCompletion;

export default provider;
