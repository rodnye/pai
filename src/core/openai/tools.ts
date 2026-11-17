import { randomUUID } from "node:crypto";

/**
 * Prompt-based tool calling. Web chats have no native function calling, so:
 *  - the tool catalogue + a calling convention are appended to the system instructions,
 *  - the model answers with ```tool_call fenced blocks holding `{"name", "arguments"}` JSON,
 *  - the reply is parsed back into OpenAI `tool_calls`,
 *  - tool results are rendered as `<tool_result>` blocks in the next prompt.
 *
 * The answer is read from the rendered page (innerText), so the parser must survive markdown
 * rendering: code-block headers ("tool_call", "Copy", ...) may appear around the JSON, or the
 * fence label may disappear entirely. JSON is located by brace matching, not by exact fences.
 */

export interface ToolDefinition {
  readonly name: string;
  readonly description?: string | undefined;
  readonly parameters?: Record<string, unknown> | undefined;
}

export type ToolChoice =
  | "none"
  | "auto"
  | "required"
  | { readonly type: "function"; readonly function: { readonly name: string } };

export interface ParsedToolCall {
  readonly name: string;
  /** Already-parsed JSON arguments. */
  readonly arguments: unknown;
}

export interface ParsedReply {
  /** Text outside the tool-call blocks (trimmed, may be empty). */
  readonly content: string;
  readonly calls: readonly ParsedToolCall[];
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

const FENCE = "```";

const renderCallBlock = (call: ParsedToolCall): string =>
  `${FENCE}tool_call\n${JSON.stringify({ name: call.name, arguments: call.arguments ?? {} })}\n${FENCE}`;

/** Appended to the system instructions whenever the request carries tools. */
export function buildToolInstructions(
  tools: readonly ToolDefinition[],
): string {
  const catalogue = tools.map((tool) => ({
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    parameters: tool.parameters ?? { type: "object", properties: {} },
  }));
  return [
    "# Tools",
    "",
    "You have access to the tools listed below (JSON Schema for each one's arguments):",
    "",
    "<tools>",
    JSON.stringify(catalogue, null, 2),
    "</tools>",
    "",
    "To call a tool, write a fenced code block with the language `tool_call` that contains a single JSON object:",
    "",
    renderCallBlock({
      name: "<tool name>",
      arguments: { "<argument>": "<value>" },
    }),
    "",
    "Tool calling rules:",
    "- `arguments` must be valid JSON that matches the tool's parameters schema. Use double quotes and escape newlines inside strings.",
    "- Write one block per call. You may call several tools in the same reply, and you may put a short sentence before the blocks.",
    "- After the tool_call blocks, STOP. Do not write anything after them and never invent or predict tool results.",
    '- The results come back in a later message as <tool_result name="...">...</tool_result> blocks; use them to continue.',
    "- Do not nest the tool_call block inside another code block, and do not describe the call instead of making it.",
    "- When no tool is needed, answer normally without any tool_call block.",
  ].join("\n");
}

/** Short per-turn nudge (not part of the fingerprinted history). Empty when there is nothing to add. */
export function buildToolReminder(
  choice: ToolChoice | undefined,
  parallel: boolean | undefined,
): string {
  const lines: string[] = [];
  if (choice === "required")
    lines.push(
      "You MUST call at least one tool in this reply, using a ```tool_call block.",
    );
  else if (typeof choice === "object")
    lines.push(
      `You MUST call the tool \`${choice.function.name}\` in this reply, using a \`\`\`tool_call block.`,
    );
  else
    lines.push(
      "Remember: call tools with ```tool_call blocks as instructed, or answer normally if no tool is needed.",
    );
  if (parallel === false) lines.push("Call at most one tool in this reply.");
  return lines.join("\n");
}

/** Returns the index just past the JSON value that starts at `start` (a `{`), or -1. */
function matchBraces(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function toCall(
  json: string,
  allowed: ReadonlySet<string>,
  requireArguments: boolean,
): ParsedToolCall | undefined {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  const name = record.name;
  if (typeof name !== "string" || !allowed.has(name)) return undefined;

  const hasArgs = "arguments" in record || "parameters" in record;
  if (requireArguments && !hasArgs) return undefined;
  let args = record.arguments ?? record.parameters ?? {};
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return undefined;
    }
  }
  if (typeof args !== "object" || args === null || Array.isArray(args))
    return undefined;
  return { name, arguments: args };
}

interface Range {
  readonly start: number;
  readonly end: number;
}

const overlaps = (ranges: readonly Range[], at: number) =>
  ranges.some((range) => at >= range.start && at < range.end);

/** Consumes a closing fence / tag right after the JSON so it does not leak into the content. */
function skipCloser(text: string, from: number): number {
  const closer = /^[ \t]*\n?[ \t]*(?:```|<\/tool_call>)/.exec(text.slice(from));
  return closer ? from + closer[0].length : from;
}

/**
 * Extracts tool calls from a reply. Only names in `allowed` are accepted, so prose that merely
 * mentions JSON is left alone.
 */
export function parseToolCalls(
  text: string,
  allowed: ReadonlySet<string>,
): ParsedReply {
  if (allowed.size === 0) return { content: text.trim(), calls: [] };

  const found: Array<Range & { call: ParsedToolCall }> = [];

  // Pass 1: explicit markers (```tool_call, <tool_call>, or the rendered code-block label).
  const marker = /(?:```[ \t]*|<)?tool_call>?/gi;
  for (const match of text.matchAll(marker)) {
    const start = match.index;
    if (overlaps(found, start)) continue;
    const after = start + match[0].length;
    const brace = text.indexOf("{", after);
    // Only short noise (whitespace, fence, "Copy"/"Download" labels) may sit between label and JSON.
    if (brace === -1 || brace - after > 60) continue;
    const end = matchBraces(text, brace);
    if (end === -1) continue;
    const call = toCall(text.slice(brace, end), allowed, false);
    if (call) found.push({ start, end: skipCloser(text, end), call });
  }

  // Pass 2: bare `{"name": ..., "arguments": ...}` objects (the fence label got lost in rendering).
  const bare = /\{\s*"name"\s*:/g;
  for (const match of text.matchAll(bare)) {
    const start = match.index;
    if (overlaps(found, start)) continue;
    const end = matchBraces(text, start);
    if (end === -1) continue;
    const call = toCall(text.slice(start, end), allowed, true);
    if (call) found.push({ start, end: skipCloser(text, end), call });
  }

  found.sort((a, b) => a.start - b.start);
  let content = "";
  let cursor = 0;
  for (const range of found) {
    content += text.slice(cursor, range.start);
    cursor = range.end;
  }
  content += text.slice(cursor);

  return {
    content: content.replace(/\n{3,}/g, "\n\n").trim(),
    calls: found.map((range) => range.call),
  };
}

/**
 * Canonical text of an assistant turn. Used both for the client's echoed `tool_calls` and for the
 * parsed reply, so the session fingerprint matches on the next request.
 */
export function renderAssistantTurn(
  content: string,
  calls: readonly ParsedToolCall[],
): string {
  return [content.trim(), ...calls.map(renderCallBlock)]
    .filter(Boolean)
    .join("\n\n");
}

export function renderToolResult(
  name: string | undefined,
  content: string,
): string {
  const attr = name ? ` name="${name.replaceAll('"', "&quot;")}"` : "";
  return `<tool_result${attr}>\n${content}\n</tool_result>`;
}

export function toOpenAIToolCalls(
  calls: readonly ParsedToolCall[],
): OpenAIToolCall[] {
  return calls.map((call) => ({
    id: `call_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
    type: "function",
    function: {
      name: call.name,
      arguments: JSON.stringify(call.arguments ?? {}),
    },
  }));
}

/** Arguments arrive from the client as a JSON string; malformed ones are kept as a raw string. */
export function parseClientArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
