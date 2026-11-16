import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Logger } from "../logger.js";

const recordSchema = z.object({
  providerId: z.string(),
  accountId: z.string(),
  sessionId: z.string(),
  fingerprint: z.string(),
  updatedAt: z.number(),
});
const fileSchema = z.object({
  version: z.literal(1),
  records: z.array(recordSchema),
});

export type SessionRecord = z.infer<typeof recordSchema>;

const keyOf = (providerId: string, fingerprint: string): string =>
  `${providerId}:${fingerprint}`;

/**
 * Maps "conversation prefix" -> "provider chat that contains exactly that prefix".
 * There is one live entry per provider chat: advancing a chat removes its previous entry, because
 * the remote chat has moved past that point and can no longer be resumed from it.
 */
export class SessionStore {
  private readonly records = new Map<string, SessionRecord>();
  private loading: Promise<void> | undefined;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly options: { ttlMs: number; maxEntries?: number },
    private readonly logger: Logger,
  ) {}

  async find(
    providerId: string,
    fingerprint: string,
  ): Promise<SessionRecord | undefined> {
    await this.load();
    const key = keyOf(providerId, fingerprint);
    const record = this.records.get(key);
    if (!record) return undefined;
    if (Date.now() - record.updatedAt > this.options.ttlMs) {
      this.records.delete(key);
      void this.persist();
      return undefined;
    }
    return record;
  }

  async advance(
    previous: SessionRecord | undefined,
    next: SessionRecord,
  ): Promise<void> {
    await this.load();
    if (previous)
      this.records.delete(keyOf(previous.providerId, previous.fingerprint));
    this.records.set(keyOf(next.providerId, next.fingerprint), next);
    this.prune();
    await this.persist();
  }

  async forget(record: SessionRecord): Promise<void> {
    await this.load();
    this.records.delete(keyOf(record.providerId, record.fingerprint));
    await this.persist();
  }

  private load(): Promise<void> {
    this.loading ??= this.read();
    return this.loading;
  }

  private async read(): Promise<void> {
    try {
      const raw = await readFile(this.file, "utf8");
      const parsed = fileSchema.parse(JSON.parse(raw));
      for (const record of parsed.records) {
        this.records.set(keyOf(record.providerId, record.fingerprint), record);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.warn(
          `Ignoring unreadable session cache ${this.file}: ${String(error)}`,
        );
      }
    }
  }

  private prune(): void {
    const max = this.options.maxEntries ?? 5_000;
    if (this.records.size <= max) return;
    const oldestFirst = [...this.records.entries()].sort(
      ([, a], [, b]) => a.updatedAt - b.updatedAt,
    );
    for (const [key] of oldestFirst.slice(0, this.records.size - max))
      this.records.delete(key);
  }

  /** Serialised, atomic (tmp file + rename) writes. Failures are logged, never thrown. */
  private persist(): Promise<void> {
    this.writeChain = this.writeChain
      .then(() => this.flush())
      .catch((error: unknown) => {
        this.logger.error(`Could not persist session cache: ${String(error)}`);
      });
    return this.writeChain;
  }

  private async flush(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    const payload = { version: 1, records: [...this.records.values()] };
    await writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
    await rename(tmp, this.file);
  }
}
