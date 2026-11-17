export const deepseekUrl = (pathname = "/") =>
  new URL(pathname, "https://chat.deepseek.com").toString();

/** Chats live at /a/chat/s/<uuid>. */
export const deepseekSessionUrl = (sessionId: string) =>
  deepseekUrl(`/a/chat/s/${encodeURIComponent(sessionId)}`);

export function parseDeepseekSessionId(url: string): string | undefined {
  try {
    return /^\/a\/chat\/s\/([0-9a-fA-F-]{8,})\/?$/.exec(
      new URL(url).pathname,
    )?.[1];
  } catch {
    return undefined;
  }
}

/** The site redirects signed-out profiles to its sign-in page. */
export function isDeepseekLoginUrl(url: string): boolean {
  try {
    return /^\/(sign_in|sign_up|login)\b/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** DeepThink can reason for minutes; give it more room than the global default. */
export function deepseekResponseTimeoutMs(globalMs: number): number {
  const raw = Number(process.env.PAI_DEEPSEEK_RESPONSE_TIMEOUT_MS);
  return Number.isInteger(raw) && raw > 0 ? raw : Math.max(globalMs, 300_000);
}
