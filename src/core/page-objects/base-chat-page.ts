import { setTimeout as sleep } from "node:timers/promises";
import type { Locator, Page } from "playwright";
import { ProviderTimeoutError } from "../errors.js";
import type { ChatPage, PageEnv } from "./chat-page.js";

export interface ChatSelectors {
  /** The prompt <textarea>. */
  readonly input: string;
  /** Every assistant answer bubble (<div>) of the thread, in DOM order. */
  readonly assistantMessage: string;
  /** "New chat" button. Optional: some sites start a new chat just by loading the base URL. */
  readonly newChatButton?: string;
  /** Visible while the model is still generating (e.g. a "Stop" button). */
  readonly busyIndicator?: string;
}

/**
 * Page Object Model base for "textarea -> Enter -> read the answer <div>" chats.
 * Subclasses only declare `baseUrl` + `selectors` and override the hooks the site needs.
 */
export abstract class BaseChatPage implements ChatPage {
  protected abstract readonly baseUrl: string;
  protected abstract readonly selectors: ChatSelectors;

  constructor(
    protected readonly page: Page,
    protected readonly env: PageEnv,
  ) {}

  // ---- Hooks for sites that expose chat ids ----------------------------------------------------

  /** URL that opens an existing chat. Return `undefined` if the site has no addressable chats. */
  protected sessionUrl(_sessionId: string): string | undefined {
    return undefined;
  }

  /** Extracts the chat id from a URL. Return `undefined` if the URL is not a chat URL. */
  protected parseSessionId(_url: string): string | undefined {
    return undefined;
  }

  // ---- Locators --------------------------------------------------------------------------------

  protected get input(): Locator {
    return this.page.locator(this.selectors.input).last();
  }

  protected get assistantMessages(): Locator {
    return this.page.locator(this.selectors.assistantMessage);
  }

  // ---- ChatPage --------------------------------------------------------------------------------

  async startNewChat(): Promise<void> {
    await this.page.goto(this.baseUrl, { waitUntil: "domcontentloaded" });

    const { newChatButton } = this.selectors;
    if (newChatButton) {
      // Best effort: the input becoming visible below is the real readiness gate.
      await this.page
        .locator(newChatButton)
        .first()
        .click({ timeout: 3_000 })
        .catch(() => undefined);
    }
    await this.input.waitFor({
      state: "visible",
      timeout: this.env.navigationTimeoutMs,
    });
  }

  async openSession(sessionId: string): Promise<boolean> {
    const url = this.sessionUrl(sessionId);
    if (!url) return false;

    try {
      const response = await this.page.goto(url, {
        waitUntil: "domcontentloaded",
      });
      if (response && !response.ok()) return false;
      await this.input.waitFor({
        state: "visible",
        timeout: this.env.navigationTimeoutMs,
      });
      // Sites usually redirect unknown/deleted chats to the home page or to a new chat.
      return this.parseSessionId(this.page.url()) === sessionId;
    } catch {
      return false;
    }
  }

  async resolveSessionId(): Promise<string | undefined> {
    const immediate = this.parseSessionId(this.page.url());
    if (immediate) return immediate;

    // After the first message many sites rewrite the URL to /chat/<id>.
    try {
      await this.page.waitForURL(
        (url) => this.parseSessionId(url.toString()) !== undefined,
        {
          timeout: Math.floor(this.env.navigationTimeoutMs / 4),
        },
      );
    } catch {
      return undefined;
    }
    return this.parseSessionId(this.page.url());
  }

  async readLastAssistantMessage(): Promise<string | undefined> {
    const last = this.assistantMessages.last();
    try {
      await last.waitFor({
        state: "visible",
        timeout: this.env.navigationTimeoutMs,
      });
      return (await last.innerText()).trim();
    } catch {
      return undefined;
    }
  }

  async selectModel(_variant: string): Promise<void> {
    // Default: the site has no model picker. Override in the provider page object.
  }

  async sendMessage(text: string): Promise<string> {
    const previousCount = await this.assistantMessages.count();
    const input = this.input;
    await input.fill(text); // fill() keeps newlines and dispatches the input events frameworks listen to
    await input.press("Enter");
    return this.collectResponse(previousCount);
  }

  // ---- Response capture ------------------------------------------------------------------------

  /**
   * Waits for a new assistant <div>, then for its text to stop changing while the site's
   * "busy" indicator (if any) is gone. Override to intercept network responses instead.
   */
  protected async collectResponse(previousCount: number): Promise<string> {
    const deadline = Date.now() + this.env.responseTimeoutMs;

    while ((await this.assistantMessages.count()) <= previousCount) {
      this.assertBefore(deadline, "the assistant message to appear");
      await sleep(this.env.pollMs);
    }

    const bubble = this.assistantMessages.last();
    let latest = "";
    let lastChange = Date.now();

    for (;;) {
      this.assertBefore(deadline, "the response to finish");
      const text = (await bubble.innerText()).trim();
      const busy = await this.isBusy();

      if (text !== latest) {
        latest = text;
        lastChange = Date.now();
      } else if (
        !busy &&
        text.length > 0 &&
        Date.now() - lastChange >= this.env.stableMs
      ) {
        return text;
      }
      await sleep(this.env.pollMs);
    }
  }

  private async isBusy(): Promise<boolean> {
    const { busyIndicator } = this.selectors;
    return busyIndicator
      ? this.page.locator(busyIndicator).first().isVisible()
      : false;
  }

  private assertBefore(deadline: number, waitingFor: string): void {
    if (Date.now() >= deadline)
      throw new ProviderTimeoutError(`Timed out waiting for ${waitingFor}.`);
  }
}
