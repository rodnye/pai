/**
 * Model ids exposed by pai: `<provider>[/<variant>][@<account>]`
 *   ia-2            -> provider ia-2, any account
 *   ia-2@work       -> provider ia-2, pinned to the "work" account
 *   ia-2/pro@work   -> provider variant "pro" (provider-specific), pinned account
 */
export interface ModelRef {
  readonly provider: string;
  readonly variant: string | undefined;
  readonly account: string | undefined;
}

const MODEL_PATTERN =
  /^(?<provider>[a-z0-9][a-z0-9-]*)(?:\/(?<variant>[^@\s]+))?(?:@(?<account>[A-Za-z0-9][A-Za-z0-9_-]{0,31}))?$/;

export function parseModelRef(model: string): ModelRef | undefined {
  const groups = MODEL_PATTERN.exec(model)?.groups;
  if (!groups?.provider) return undefined;
  return {
    provider: groups.provider,
    variant: groups.variant,
    account: groups.account,
  };
}
