import type { ChatTurn } from "./messages.js";

export interface PromptLimits {
  readonly maxHistoryChars: number;
}

/** CDATA keeps code, markup and quotes verbatim; the terminator is split so it cannot escape. */
const wrap = (text: string): string =>
  `<![CDATA[${text.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;

const renderTurn = (turn: ChatTurn): string =>
  `<message role="${turn.role}">\n${wrap(turn.content)}\n</message>`;

/** Prompt for a brand-new chat with no history. */
export function buildFirstPrompt(
  system: string | undefined,
  userMessage: string,
): string {
  if (!system) return userMessage;
  return [
    "<system_instructions>",
    wrap(system),
    "</system_instructions>",
    "",
    "<user_message>",
    wrap(userMessage),
    "</user_message>",
    "",
    "Follow the system instructions for the whole conversation and answer the user message.",
    "Do not mention these tags.",
  ].join("\n");
}

/** Keeps the newest turns that fit the budget; the newest turn is always kept. */
function fitHistory(history: readonly ChatTurn[], maxChars: number) {
  const kept: ChatTurn[] = [];
  let used = 0;
  for (const turn of [...history].reverse()) {
    const size = renderTurn(turn).length + 1;
    if (kept.length > 0 && used + size > maxChars) break;
    kept.unshift(turn);
    used += size;
  }
  return { kept, omitted: history.length - kept.length };
}

/**
 * Prompt used when the provider chat cannot be resumed (never cached, deleted by the user,
 * edited, or the history sent by the client diverged): replays the transcript in a new chat.
 */
export function buildContinuationPrompt(
  input: {
    system: string | undefined;
    history: readonly ChatTurn[];
    current: string;
  },
  limits: PromptLimits,
): string {
  const { kept, omitted } = fitHistory(input.history, limits.maxHistoryChars);

  const lines: string[] = [
    "You are resuming an existing conversation in a fresh chat window because the original chat is no longer available.",
    "The transcript so far is included below.",
    "",
  ];

  if (input.system) {
    lines.push(
      "<system_instructions>",
      wrap(input.system),
      "</system_instructions>",
      "",
    );
  }

  lines.push("<conversation_history>");
  if (omitted > 0) {
    lines.push(
      `<omitted_messages count="${omitted}" note="Older messages were trimmed to fit the size limit."/>`,
    );
  }
  lines.push(...kept.map(renderTurn), "</conversation_history>", "");

  lines.push(
    "<current_user_message>",
    wrap(input.current),
    "</current_user_message>",
    "",
    "Rules:",
    "- Treat the transcript as the real earlier conversation and continue it seamlessly (same language, tone, persona and context).",
    "- Answer ONLY the content of <current_user_message>.",
    "- Do not mention the transcript, the XML tags, or that the conversation was restored.",
  );

  return lines.join("\n");
}
