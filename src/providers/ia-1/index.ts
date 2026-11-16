import { defineProvider } from "../../core/provider.js";
import { Ia1ChatPage } from "./pages/chat.page.js";

export const provider = defineProvider({
  id: "ia-1",
  displayName: "IA 1 (stateless)",
  loginUrl: "https://ia-1.example.com/login", // PLACEHOLDER
  sessionStrategy: "stateless",
  createPage: (page, env) => new Ia1ChatPage(page, env),
});

export const createChatCompletion = provider.createChatCompletion;

export default provider;
