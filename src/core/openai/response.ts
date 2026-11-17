import { randomUUID } from "node:crypto";
import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  FinishReason,
} from "./schema.js";
import type { OpenAIToolCall } from "./tools.js";

/** Rough estimate (~4 chars/token): web chats do not report real token usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function buildChatCompletion(input: {
  model: string;
  content: string;
  toolCalls?: OpenAIToolCall[];
  promptText: string;
}): ChatCompletionResponse {
  const toolCalls = input.toolCalls?.length ? input.toolCalls : undefined;
  const promptTokens = estimateTokens(input.promptText);
  const completionTokens = estimateTokens(
    input.content +
      (toolCalls?.map((call) => call.function.arguments).join("") ?? ""),
  );
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: input.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          // OpenAI sends null content when the turn is only tool calls.
          content: toolCalls && input.content === "" ? null : input.content,
          refusal: null,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
        logprobs: null,
        finish_reason: toolCalls ? "tool_calls" : "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

export function buildChunk(
  base: Pick<ChatCompletionResponse, "id" | "created" | "model">,
  delta: ChatCompletionChunk["choices"][number]["delta"],
  finishReason: FinishReason | null,
): ChatCompletionChunk {
  return {
    id: base.id,
    object: "chat.completion.chunk",
    created: base.created,
    model: base.model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

/** Splits by code point so surrogate pairs are never cut in half. */
export function chunkText(text: string, size: number): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let i = 0; i < chars.length; i += size)
    chunks.push(chars.slice(i, i + size).join(""));
  return chunks;
}
