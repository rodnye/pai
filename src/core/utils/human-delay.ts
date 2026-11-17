import { setTimeout as sleep } from "node:timers/promises";

export interface DelayRange {
  readonly minMs: number;
  readonly maxMs: number;
}

/** Uniform random integer in [minMs, maxMs]. */
export function pickDelay(
  range: DelayRange,
  random: () => number = Math.random,
): number {
  const span = Math.max(0, range.maxMs - range.minMs);
  return range.minMs + Math.floor(random() * (span + 1));
}

/** Waits a random amount of time within `range` (no-op when the range is 0-0). */
export async function humanPause(range: DelayRange): Promise<void> {
  const ms = pickDelay(range);
  if (ms > 0) await sleep(ms);
}

/**
 * Splits `text` into the part typed key by key (the first `maxTypedChars` characters, counted by
 * code point so emojis are never cut in half) and the rest, which is inserted at once.
 */
export function splitForTyping(
  text: string,
  maxTypedChars: number,
): { readonly typed: string[]; readonly rest: string } {
  const chars = Array.from(text);
  const limit = Math.max(0, maxTypedChars);
  return {
    typed: chars.slice(0, limit),
    rest: chars.slice(limit).join(""),
  };
}
