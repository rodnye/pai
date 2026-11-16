import { createHash } from "node:crypto";
import type { SplitConversation } from "./messages.js";
import { normalizeText } from "./messages.js";

/**
 * Stable identity of a conversation prefix. It is used to find the provider chat that already
 * contains exactly this history, so the next turn can continue it instead of replaying everything.
 */
export function fingerprintConversation(
  conversation: Pick<SplitConversation, "system" | "history">,
): string {
  const payload = [
    conversation.system === undefined
      ? null
      : normalizeText(conversation.system),
    conversation.history.map((turn) => [
      turn.role,
      normalizeText(turn.content),
    ]),
  ];
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
