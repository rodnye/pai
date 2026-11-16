import { z } from "zod";

const textPartSchema = z.object({ type: z.literal("text"), text: z.string() });

export const messageSchema = z.object({
  role: z.enum(["system", "developer", "user", "assistant", "tool"]),
  // Only text is supported: web chats are driven through a plain <textarea>.
  content: z.union([z.string(), z.array(textPartSchema)]).nullish(),
});

/**
 * Sampling params (temperature, max_tokens, ...) are accepted by OpenAI clients but cannot be
 * honoured when scraping a web UI, so zod strips them silently.
 */
export const chatCompletionRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  stream: z.boolean().optional(),
});

export type ChatCompletionRequest = z.infer<typeof chatCompletionRequestSchema>;
export type ChatMessage = ChatCompletionRequest["messages"][number];

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string; refusal: null };
    logprobs: null;
    finish_reason: "stop";
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: "assistant"; content?: string };
    finish_reason: "stop" | null;
  }>;
}
