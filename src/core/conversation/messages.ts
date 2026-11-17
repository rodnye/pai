import { BadRequestError } from "../errors.js";
import type { ChatMessage } from "../openai/schema.js";
import {
  parseClientArguments,
  renderAssistantTurn,
  renderToolResult,
} from "../openai/tools.js";

export type Role = "system" | "user" | "assistant" | "tool";

export interface ChatTurn {
  readonly role: Role;
  readonly content: string;
}

export interface SplitConversation {
  /** All system/developer messages, merged. */
  readonly system: string | undefined;
  /** Every dialogue turn before the one being answered. */
  readonly history: readonly ChatTurn[];
  /** The message that must be answered now: a user message or the results of the last tool calls. */
  readonly current: ChatTurn;
}

export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function flatten(content: ChatMessage["content"]): string {
  if (content === null || content === undefined) return "";
  return typeof content === "string"
    ? content
    : content.map((part) => part.text).join("\n");
}

/**
 * Flattens OpenAI messages into text turns. Tool calls and tool results are rendered with the same
 * convention the model is asked to use (see openai/tools.ts), and consecutive tool results are
 * merged into a single turn so they reach the chat as one message.
 */
export function normalizeMessages(
  messages: readonly ChatMessage[],
): ChatTurn[] {
  const turns: ChatTurn[] = [];
  const callNames = new Map<string, string>();

  for (const message of messages) {
    const text = normalizeText(flatten(message.content));

    if (message.role === "assistant" && message.tool_calls?.length) {
      const calls = message.tool_calls.map((call) => {
        callNames.set(call.id, call.function.name);
        return {
          name: call.function.name,
          arguments: parseClientArguments(call.function.arguments),
        };
      });
      turns.push({
        role: "assistant",
        content: renderAssistantTurn(text, calls),
      });
      continue;
    }

    if (message.role === "tool") {
      const name =
        message.name ??
        (message.tool_call_id
          ? callNames.get(message.tool_call_id)
          : undefined);
      const block = renderToolResult(name, text);
      const previous = turns.at(-1);
      if (previous?.role === "tool") {
        turns[turns.length - 1] = {
          role: "tool",
          content: `${previous.content}\n\n${block}`,
        };
      } else {
        turns.push({ role: "tool", content: block });
      }
      continue;
    }

    if (text === "") continue;
    turns.push({
      role: message.role === "developer" ? "system" : message.role,
      content: text,
    });
  }
  return turns;
}

export function splitConversation(
  turns: readonly ChatTurn[],
): SplitConversation {
  const system = turns
    .filter((turn) => turn.role === "system")
    .map((turn) => turn.content)
    .join("\n\n");
  const dialogue = turns.filter((turn) => turn.role !== "system");
  const current = dialogue.at(-1);

  if (!current || (current.role !== "user" && current.role !== "tool")) {
    throw new BadRequestError(
      "The last message must come from the 'user' or 'tool' role.",
      "invalid_messages",
    );
  }
  return {
    system: system || undefined,
    history: dialogue.slice(0, -1),
    current,
  };
}
