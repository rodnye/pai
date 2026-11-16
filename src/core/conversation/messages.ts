import { BadRequestError } from "../errors.js";
import type { ChatMessage } from "../openai/schema.js";

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
  /** The user message that must be answered now. */
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

export function normalizeMessages(
  messages: readonly ChatMessage[],
): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const message of messages) {
    const content = normalizeText(flatten(message.content));
    if (content === "") continue; // e.g. assistant tool-call stubs
    turns.push({
      role: message.role === "developer" ? "system" : message.role,
      content,
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

  if (!current || current.role !== "user") {
    throw new BadRequestError(
      "The last message must come from the 'user' role.",
      "invalid_messages",
    );
  }
  return {
    system: system || undefined,
    history: dialogue.slice(0, -1),
    current,
  };
}
