import { defineProvider } from "../../core/provider.js";
import { Ia2ChatPage } from "./pages/chat.page.js";

export const provider = defineProvider({
  id: "ia-2",
  displayName: "IA 2 (resumable sessions)",
  loginUrl: "https://ia-2.example.com/login", // PLACEHOLDER
  sessionStrategy: "resumable",
  createPage: (page, env) => new Ia2ChatPage(page, env),
});

/** OpenAI-compatible entry point: (ChatCompletionRequest) => Promise<ChatCompletionResponse>. */
export const createChatCompletion = provider.createChatCompletion;

export default provider;
