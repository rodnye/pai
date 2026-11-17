import { z } from "zod";
import type { OpenAIToolCall } from "./tools.js";

const textPartSchema = z.object({ type: z.literal("text"), text: z.string() });

const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function").optional(),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

export const messageSchema = z.object({
  role: z.enum(["system", "developer", "user", "assistant", "tool"]),
  // Only text is supported: web chats are driven through a plain <textarea>.
  content: z.union([z.string(), z.array(textPartSchema)]).nullish(),
  /** Assistant turns that called tools. */
  tool_calls: z.array(toolCallSchema).nullish(),
  /** Tool turns: the call they answer. */
  tool_call_id: z.string().nullish(),
  name: z.string().nullish(),
});

const toolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  }),
});

const toolChoiceSchema = z.union([
  z.enum(["none", "auto", "required"]),
  z.object({
    type: z.literal("function"),
    function: z.object({ name: z.string() }),
  }),
]);

/**
 * Sampling params (temperature, max_tokens, ...) are accepted by OpenAI clients but cannot be
 * honoured when scraping a web UI, so zod strips them silently.
 */
export const chatCompletionRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  stream: z.boolean().optional(),
  tools: z.array(toolSchema).optional(),
  tool_choice: toolChoiceSchema.optional(),
  parallel_tool_calls: z.boolean().optional(),
});

export type ChatCompletionRequest = z.infer<typeof chatCompletionRequestSchema>;
export type ChatMessage = ChatCompletionRequest["messages"][number];

export type FinishReason = "stop" | "tool_calls";

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      refusal: null;
      tool_calls?: OpenAIToolCall[];
    };
    logprobs: null;
    finish_reason: FinishReason;
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
    delta: {
      role?: "assistant";
      content?: string;
      tool_calls?: Array<OpenAIToolCall & { index: number }>;
    };
    finish_reason: FinishReason | null;
  }>;
}
