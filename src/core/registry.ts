import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ModelNotFoundError } from "./errors.js";
import type { Logger } from "./logger.js";
import { parseModelRef, type ModelRef } from "./model-ref.js";
import type { Provider } from "./provider.js";

/** A model id that clients can send as `model` (accounts are appended with `@<account>`). */
export interface ModelEntry {
  /** `<provider>` or `<provider>/<variant>`. */
  readonly id: string;
  readonly provider: Provider;
  readonly variant: string | undefined;
}

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const ENTRY_CANDIDATES = ["index.js", "index.ts"] as const; // .js when built, .ts under tsx
const DEFAULT_PROVIDERS_DIR = fileURLToPath(
  new URL("../providers", import.meta.url),
);

export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>();

  register(provider: Provider): void {
    if (this.providers.has(provider.id))
      throw new Error(`Duplicate provider id '${provider.id}'.`);
    this.providers.set(provider.id, provider);
  }

  list(): Provider[] {
    return [...this.providers.values()];
  }

  /**
   * Every model id, grouped by provider in registration order: one `<provider>/<variant>` per
   * known variant, or the bare `<provider>` when the provider declares no variants.
   */
  listModels(): ModelEntry[] {
    return this.list().flatMap((provider): ModelEntry[] =>
      provider.variants.length > 0
        ? provider.variants.map((variant) => ({
            id: `${provider.id}/${variant}`,
            provider,
            variant,
          }))
        : [{ id: provider.id, provider, variant: undefined }],
    );
  }

  get(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  require(id: string): Provider {
    const provider = this.get(id);
    if (!provider) throw new ModelNotFoundError(id, [...this.providers.keys()]);
    return provider;
  }

  resolve(model: string): { provider: Provider; ref: ModelRef } {
    const ref = parseModelRef(model);
    if (!ref) throw new ModelNotFoundError(model, [...this.providers.keys()]);
    return { provider: this.require(ref.provider), ref };
  }
}

function isProvider(value: unknown): value is Provider {
  const candidate = value as Partial<Provider> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.id === "string" &&
    typeof candidate.createChatCompletion === "function"
  );
}

async function findEntry(directory: string): Promise<string | undefined> {
  for (const name of ENTRY_CANDIDATES) {
    const file = path.join(directory, name);
    try {
      await access(file);
      return file;
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

/**
 * Every folder in `src/providers/` whose name looks like a provider id and that exports a
 * `provider` (named or default) is registered automatically. Folders starting with `_` are ignored.
 */
export async function discoverProviders(
  logger: Logger,
  directory: string = DEFAULT_PROVIDERS_DIR,
): Promise<ProviderRegistry> {
  const registry = new ProviderRegistry();
  const entries = await readdir(directory, { withFileTypes: true });
  const folders = entries
    .filter(
      (entry) => entry.isDirectory() && PROVIDER_ID_PATTERN.test(entry.name),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const folder of folders) {
    const entryFile = await findEntry(path.join(directory, folder.name));
    if (!entryFile) {
      logger.warn(
        `Provider folder '${folder.name}' has no index file; skipping.`,
      );
      continue;
    }

    const mod = (await import(pathToFileURL(entryFile).href)) as {
      provider?: unknown;
      default?: unknown;
    };
    const candidate = mod.provider ?? mod.default;
    if (!isProvider(candidate)) {
      logger.warn(
        `'${folder.name}' does not export a provider (use defineProvider); skipping.`,
      );
      continue;
    }
    if (candidate.id !== folder.name) {
      throw new Error(
        `Provider folder '${folder.name}' declares id '${candidate.id}'; they must match.`,
      );
    }
    registry.register(candidate);
  }
  return registry;
}
