/**
 * Model ids exposed by pai: `<model>[/<variant>][@<account>]`, where `<model>` is the provider id
 * (its folder name in src/providers):
 *   deepseek                   -> provider deepseek, any account
 *   deepseek@work              -> pinned to the "work" account
 *   deepseek/think-search@work -> provider-specific variant "think-search", pinned account
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
