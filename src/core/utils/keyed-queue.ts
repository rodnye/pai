/**
 * Runs async tasks one at a time per key, and different keys in parallel.
 * A failing task never blocks the tasks queued behind it.
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly counts = new Map<string, number>();

  /** Number of tasks queued or running for `key`. */
  pending(key: string): number {
    return this.counts.get(key) ?? 0;
  }

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    this.counts.set(key, this.pending(key) + 1);

    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task);
    const tail = result
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        const remaining = this.pending(key) - 1;
        if (remaining <= 0) {
          this.counts.delete(key);
          this.tails.delete(key);
        } else {
          this.counts.set(key, remaining);
        }
      });

    this.tails.set(key, tail);
    return result;
  }
}
