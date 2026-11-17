/**
 * `deepseek/<variant>[@<account>]` maps to the two composer toggles. Without a variant the toggles are left as
 * they are in the profile (whatever was set during `pnpm auth deepseek`).
 */
export interface DeepseekToggles {
  readonly think: boolean;
  readonly search: boolean;
}

export const DEEPSEEK_VARIANTS = {
  chat: { think: false, search: false },
  think: { think: true, search: false },
  search: { think: false, search: true },
  "think-search": { think: true, search: true },
} as const satisfies Record<string, DeepseekToggles>;

export type DeepseekVariant = keyof typeof DEEPSEEK_VARIANTS;

export function deepseekToggles(variant: string): DeepseekToggles | undefined {
  return Object.hasOwn(DEEPSEEK_VARIANTS, variant)
    ? DEEPSEEK_VARIANTS[variant as DeepseekVariant]
    : undefined;
}
