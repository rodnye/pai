/**
 * `deepseek/<variant>` maps to the two composer toggles. Without a variant the toggles are left as
 * they are in the profile (whatever was set during `pnpm auth deepseek`).
 */
export interface DeepseekToggles {
  readonly deepThink: boolean;
  readonly search: boolean;
}

export const DEEPSEEK_VARIANTS = {
  chat: { deepThink: false, search: false },
  think: { deepThink: true, search: false },
  search: { deepThink: false, search: true },
  "think-search": { deepThink: true, search: true },
} as const satisfies Record<string, DeepseekToggles>;

export type DeepseekVariant = keyof typeof DEEPSEEK_VARIANTS;

export function deepseekToggles(variant: string): DeepseekToggles | undefined {
  return Object.hasOwn(DEEPSEEK_VARIANTS, variant)
    ? DEEPSEEK_VARIANTS[variant as DeepseekVariant]
    : undefined;
}
