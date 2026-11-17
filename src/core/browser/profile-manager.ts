import { readdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { Config } from "../config.js";
import { AccountNotFoundError, BadRequestError } from "../errors.js";
import type { Logger } from "../logger.js";
import type { BrowserOptions } from "../provider.js";
import { KeyedQueue } from "../utils/keyed-queue.js";

export const DEFAULT_ACCOUNT = "default";
export const ACCOUNT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

const isNotFound = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

/**
 * Owns the persistent browser profiles ("userDirs"), one per provider + account:
 *   <dataDir>/profiles/<provider>/<account>/
 *
 * - A Chromium profile cannot be opened by two processes, so requests for the same account are
 *   serialised through a queue, while different accounts run in parallel.
 * - Contexts are launched lazily, reused, and closed after `contextIdleMs` without traffic.
 * - Each account keeps one tab that is reused between requests and closed after `pageIdleMs`.
 */
export class ProfileManager {
  private readonly contexts = new Map<string, Promise<BrowserContext>>();
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();
  private readonly pages = new Map<string, Page>();
  private readonly pageTimers = new Map<string, NodeJS.Timeout>();
  private readonly queue = new KeyedQueue();
  private readonly log: Logger;

  constructor(
    private readonly config: Config,
    logger: Logger,
  ) {
    this.log = logger.child("profiles");
  }

  userDir(providerId: string, account: string): string {
    // The account may come from an HTTP request: never let it escape the profiles directory.
    if (!ACCOUNT_NAME_PATTERN.test(account)) {
      throw new BadRequestError(
        `Invalid account name '${account}'.`,
        "invalid_account",
      );
    }
    return path.join(this.config.dataDir, "profiles", providerId, account);
  }

  /** Existing accounts; falls back to a virtual "default" so sites without login work out of the box. */
  async listAccounts(providerId: string): Promise<string[]> {
    const root = path.join(this.config.dataDir, "profiles", providerId);
    let names: string[] = [];
    try {
      const entries = await readdir(root, { withFileTypes: true });
      names = entries
        .filter(
          (entry) =>
            entry.isDirectory() && ACCOUNT_NAME_PATTERN.test(entry.name),
        )
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    return names.length > 0 ? names : [DEFAULT_ACCOUNT];
  }

  /**
   * - `pinned`: the caller demands this account (must exist).
   * - `preferred`: soft affinity (e.g. the account that owns a cached chat), used if it still exists.
   * - otherwise the least busy account is picked.
   */
  async resolveAccount(
    providerId: string,
    choice: {
      pinned?: string | undefined;
      preferred?: string | undefined;
    } = {},
  ): Promise<string> {
    const accounts = await this.listAccounts(providerId);

    if (choice.pinned) {
      if (!accounts.includes(choice.pinned)) {
        throw new AccountNotFoundError(providerId, choice.pinned, accounts);
      }
      return choice.pinned;
    }
    if (choice.preferred && accounts.includes(choice.preferred))
      return choice.preferred;

    return accounts.reduce((best, candidate) =>
      this.load(providerId, candidate) < this.load(providerId, best)
        ? candidate
        : best,
    );
  }

  /** Runs `task` with a fresh page of the account's profile, exclusively for that account. */
  async withPage<T>(
    providerId: string,
    account: string,
    task: (page: Page) => Promise<T>,
    browser: BrowserOptions = {},
  ): Promise<T> {
    const key = this.key(providerId, account);
    const userDir = this.userDir(providerId, account);

    return this.queue.run(key, async () => {
      this.cancelIdleClose(key);
      this.cancelPageIdleClose(key);
      try {
        const context = await this.acquireContext(key, userDir, browser);
        const page = await this.acquirePage(key, context);
        try {
          const result = await task(page);
          this.schedulePageIdleClose(key);
          return result;
        } catch (error) {
          // A failed run may leave the tab in an odd state (dialogs, half-loaded page): start clean next time.
          await this.discardPage(key);
          throw error;
        }
      } finally {
        this.scheduleIdleClose(key);
      }
    });
  }

  /**
   * Reuses the account's tab across requests instead of opening/closing one per request, which
   * looks robotic. Prefers the tab Chromium opens with the persistent context.
   */
  private async acquirePage(
    key: string,
    context: BrowserContext,
  ): Promise<Page> {
    const existing = this.pages.get(key);
    if (existing && !existing.isClosed() && existing.context() === context) {
      return existing;
    }
    const page =
      context.pages().find((candidate) => !candidate.isClosed()) ??
      (await context.newPage());
    this.pages.set(key, page);
    page.once("close", () => {
      if (this.pages.get(key) === page) this.pages.delete(key);
    });
    return page;
  }

  private async discardPage(key: string): Promise<void> {
    this.cancelPageIdleClose(key);
    const page = this.pages.get(key);
    this.pages.delete(key);
    await page?.close().catch(() => undefined);
  }

  private cancelPageIdleClose(key: string): void {
    clearTimeout(this.pageTimers.get(key));
    this.pageTimers.delete(key);
  }

  private schedulePageIdleClose(key: string): void {
    this.cancelPageIdleClose(key);
    const timer: NodeJS.Timeout = setTimeout(() => {
      void this.queue.run(key, async () => {
        if (this.pageTimers.get(key) !== timer) return; // the tab was used since this timer was armed
        this.pageTimers.delete(key);
        await this.discardPage(key);
        this.log.debug(`Closed idle tab of ${key}`);
      });
    }, this.config.pageIdleMs);
    timer.unref();
    this.pageTimers.set(key, timer);
  }

  /**
   * Opens the profile in a visible browser so the user can register, log in or tweak settings.
   * Cookies, localStorage and IndexedDB are written to the userDir when the context closes.
   */
  async authenticate(
    providerId: string,
    account: string,
    loginUrl: string,
    waitForUser: () => Promise<void>,
    browser: BrowserOptions = {},
  ): Promise<void> {
    const userDir = this.userDir(providerId, account);
    const context = await this.launch(userDir, false, browser);
    const closedByUser = new Promise<void>((resolve) =>
      context.once("close", () => resolve()),
    );

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page
        .goto(loginUrl, { waitUntil: "domcontentloaded" })
        .catch((error: unknown) => {
          this.log.warn(
            `Could not open ${loginUrl}, navigate manually: ${String(error)}`,
          );
        });
      await Promise.race([waitForUser(), closedByUser]);
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  async closeAll(): Promise<void> {
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
    for (const timer of this.pageTimers.values()) clearTimeout(timer);
    this.pageTimers.clear();
    await Promise.allSettled(
      [...this.contexts.keys()].map((key) => this.closeContext(key)),
    );
  }

  private key(providerId: string, account: string): string {
    return `${providerId}/${account}`;
  }

  private load(providerId: string, account: string): number {
    return this.queue.pending(this.key(providerId, account));
  }

  private acquireContext(
    key: string,
    userDir: string,
    browser: BrowserOptions,
  ): Promise<BrowserContext> {
    const existing = this.contexts.get(key);
    if (existing) return existing;

    this.log.info(`Launching browser profile ${userDir}`);
    const launched = this.launch(userDir, this.config.headless, browser);
    this.contexts.set(key, launched);

    const forget = (): void => {
      if (this.contexts.get(key) === launched) this.contexts.delete(key);
    };
    launched.then((context) => context.once("close", forget), forget);
    return launched;
  }

  private launch(
    userDir: string,
    headless: boolean,
    browser: BrowserOptions,
  ): Promise<BrowserContext> {
    return chromium.launchPersistentContext(userDir, {
      headless,
      locale: browser.locale,
      channel: this.config.browserChannel,
      viewport: headless ? { width: 1366, height: 900 } : null,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  }

  private async closeContext(key: string): Promise<void> {
    const pending = this.contexts.get(key);
    if (!pending) return;
    this.contexts.delete(key);
    this.cancelPageIdleClose(key);
    this.pages.delete(key);
    try {
      await (await pending).close();
      this.log.debug(`Closed browser profile ${key}`);
    } catch (error) {
      this.log.debug(`Error while closing ${key}: ${String(error)}`);
    }
  }

  private cancelIdleClose(key: string): void {
    clearTimeout(this.idleTimers.get(key));
    this.idleTimers.delete(key);
  }

  private scheduleIdleClose(key: string): void {
    clearTimeout(this.idleTimers.get(key));
    const timer: NodeJS.Timeout = setTimeout(() => {
      // Closing goes through the queue so it can never race with a request that is starting.
      void this.queue.run(key, async () => {
        if (this.idleTimers.get(key) !== timer) return; // activity happened since this timer was armed
        this.idleTimers.delete(key);
        await this.closeContext(key);
      });
    }, this.config.contextIdleMs);
    timer.unref();
    this.idleTimers.set(key, timer);
  }
}
