/** PLACEHOLDER: the real site. Override with PAI_IA1_BASE_URL (e.g. the local mock). */
const DEFAULT_BASE_URL = "https://ia-1.example.com";

/** Resolved lazily so the value set in `.env` (loaded by the CLI) is always honoured. */
export function ia1Url(pathname = "/"): string {
  return new URL(
    pathname,
    process.env.PAI_IA1_BASE_URL || DEFAULT_BASE_URL,
  ).toString();
}
