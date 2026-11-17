import { setTimeout as sleep } from "node:timers/promises";
import type { Locator } from "playwright";
import {
  BadRequestError,
  ProviderAutomationError,
  ProviderTimeoutError,
} from "../../../core/errors.js";
import { BaseChatPage } from "../../../core/page-objects/base-chat-page.js";
import {
  deepseekSessionUrl,
  deepseekUrl,
  isDeepseekLoginUrl,
  parseDeepseekSessionId,
} from "../endpoints.js";
import { DEEPSEEK_DOM, DEEPSEEK_SELECTORS } from "../selectors.js";
import { deepseekToggles } from "../variants.js";

/** Attribute stamped on every message bubble that existed before a prompt was sent. */
const SEEN_ATTR = "data-pai-seen";
/** Grace period before an error notification (e.g. "server busy") is treated as a failure. */
const NOTICE_GRACE_MS = 5_000;

interface ComposerSnapshot {
  /** The send button shows the stop icon. */
  readonly generating: boolean;
  /** The last bubble is an assistant message created after our prompt was sent. */
  readonly newAnswer: boolean;
  /** innerText of that message's final answer (reasoning excluded). */
  readonly answer: string;
  /** That message already shows its action bar ("Read aloud"). */
  readonly finished: boolean;
  /** Text of the notification area, if any (errors such as "server busy" show up there). */
  readonly notice: string;
}

const signedOutError = (): ProviderAutomationError =>
  new ProviderAutomationError(
    "DeepSeek: this profile is not signed in. Run `pnpm auth deepseek` (add --account <name> if needed).",
  );

const challengeError = (): ProviderAutomationError =>
  new ProviderAutomationError(
    "DeepSeek: Cloudflare challenge is blocking the page. Solve it once with `pnpm auth deepseek`, " +
      "and consider PAI_HEADLESS=false or PAI_BROWSER_CHANNEL=chrome.",
  );

/**
 * DeepSeek chat (chat.deepseek.com). Differences with the generic "textarea -> Enter -> div" flow,
 * all taken from INFORME_PLAYWRIGHT_DEEPSEEK.md:
 *
 * - The message list is virtualised, so "count bubbles before/after" is unreliable. Bubbles present
 *   before sending are stamped with `data-pai-seen`; the answer is the last un-stamped assistant one.
 * - Completion = stop icon gone + "Read aloud" action bar present + text stable for `stableMs`.
 *   If "Read aloud" never shows up (UI change), a longer stability window is used instead.
 * - The prompt is sent by clicking the send button (Enter behaviour was not verified).
 * - Sign-in redirects and the Cloudflare challenge raise descriptive errors instead of timeouts.
 * - Variants (`deepseek/think`, ...) drive the DeepThink and Search toggles.
 */
export class DeepseekChatPage extends BaseChatPage {
  protected readonly baseUrl = deepseekUrl("/");
  protected readonly selectors = DEEPSEEK_SELECTORS;

  protected override sessionUrl(sessionId: string): string {
    return deepseekSessionUrl(sessionId);
  }

  protected override parseSessionId(url: string): string | undefined {
    return parseDeepseekSessionId(url);
  }

  // ---- Readiness -------------------------------------------------------------------------------

  protected override async waitUntilReady(): Promise<void> {
    const timeout = this.env.navigationTimeoutMs;
    let state: "ready" | "login";
    try {
      state = await Promise.any([
        this.input
          .waitFor({ state: "visible", timeout })
          .then(() => "ready" as const),
        this.page
          .waitForURL((url) => isDeepseekLoginUrl(url.toString()), { timeout })
          .then(() => "login" as const),
      ]);
    } catch (error) {
      if (await this.challengeVisible()) throw challengeError();
      throw error instanceof AggregateError ? error.errors[0] : error;
    }
    if (state === "login") throw signedOutError();
  }

  // ---- Variants (DeepThink / Search toggles) ---------------------------------------------------

  override async selectModel(variant: string): Promise<void> {
    const wanted = deepseekToggles(variant);
    if (!wanted) {
      throw new BadRequestError(
        `Unknown DeepSeek variant '${variant}'.`,
        "model_not_found",
      );
    }
    await this.setToggle("DeepThink", wanted.deepThink);
    await this.setToggle("Search", wanted.search);
  }

  private async setToggle(label: string, on: boolean): Promise<void> {
    const toggle = this.page
      .locator(DEEPSEEK_DOM.toggle)
      .filter({ hasText: new RegExp(`^\\s*${label}\\b`) })
      .first();
    await toggle.waitFor({
      state: "visible",
      timeout: this.env.navigationTimeoutMs,
    });
    if ((await readToggleState(toggle)) === on) return;

    await toggle.click();
    const deadline = Date.now() + 3_000;
    while ((await readToggleState(toggle)) !== on) {
      if (Date.now() >= deadline) {
        throw new ProviderAutomationError(
          `DeepSeek: could not turn ${on ? "on" : "off"} the "${label}" toggle ` +
            "(its active-state marker may have changed; see readToggleState in the deepseek page object).",
        );
      }
      await sleep(100);
    }
  }

  // ---- Sending ---------------------------------------------------------------------------------

  protected override async submit(): Promise<void> {
    await this.page.evaluate(
      ({ selector, attr }) => {
        for (const el of document.querySelectorAll(selector))
          el.setAttribute(attr, "1");
      },
      { selector: DEEPSEEK_DOM.message, attr: SEEN_ATTR },
    );

    const { sendButton } = DEEPSEEK_SELECTORS;
    try {
      // The button is disabled until the textarea's input event has been processed.
      await this.page.waitForFunction(
        ({ selector, disabledClass }) => {
          const buttons = document.querySelectorAll(selector);
          const button = buttons[buttons.length - 1];
          return !!button && !button.classList.contains(disabledClass);
        },
        { selector: sendButton, disabledClass: DEEPSEEK_DOM.disabledClass },
        { timeout: 5_000, polling: 100 },
      );
      await this.page.locator(sendButton).last().click({ timeout: 10_000 });
    } catch (error) {
      if (await this.challengeVisible()) throw challengeError();
      throw new ProviderAutomationError(
        "DeepSeek: the send button did not become clickable.",
        { cause: error },
      );
    }
  }

  protected override async collectResponse(): Promise<string> {
    const { responseTimeoutMs, stableMs, pollMs } = this.env;
    const startedAt = Date.now();
    const deadline = startedAt + responseTimeoutMs;
    const fallbackStableMs = Math.max(stableMs * 5, 10_000);

    let started = false;
    let latest = "";
    let lastChange = Date.now();

    for (;;) {
      if (Date.now() >= deadline) {
        throw new ProviderTimeoutError(
          started
            ? "DeepSeek: timed out waiting for the answer to finish."
            : "DeepSeek: the answer never started.",
        );
      }

      const snap = await this.snapshot();
      if (!started) {
        started = snap.generating || snap.newAnswer;
        if (!started && Date.now() - startedAt > NOTICE_GRACE_MS) {
          if (await this.challengeVisible()) throw challengeError();
          if (snap.notice)
            throw new ProviderAutomationError(`DeepSeek: ${snap.notice}`);
        }
      }

      if (snap.newAnswer) {
        if (snap.answer !== latest) {
          latest = snap.answer;
          lastChange = Date.now();
        } else if (!snap.generating && latest.length > 0) {
          const stableFor = Date.now() - lastChange;
          if (
            (snap.finished && stableFor >= stableMs) ||
            stableFor >= fallbackStableMs
          ) {
            return latest;
          }
        }
      }
      await sleep(pollMs);
    }
  }

  // ---- DOM probes ------------------------------------------------------------------------------

  /** One round-trip that reads the whole composer/thread state. */
  private snapshot(): Promise<ComposerSnapshot> {
    return this.page.evaluate(
      ({ sel, attr }) => {
        const buttons = document.querySelectorAll(sel.sendButton);
        const button = buttons[buttons.length - 1];
        const iconPath =
          button?.querySelector("svg path")?.getAttribute("d") ?? "";

        const messages = document.querySelectorAll(sel.message);
        const last = messages[messages.length - 1];
        const isAssistant =
          !!last &&
          !!(
            last.querySelector(sel.answer) || last.querySelector(sel.thinking)
          );
        const answerEl = last?.querySelector<HTMLElement>(sel.answer);

        return {
          generating: iconPath.startsWith(sel.stopIconPathPrefix),
          newAnswer: isAssistant && !last.hasAttribute(attr),
          answer: answerEl?.innerText.trim() ?? "",
          finished: !!last?.querySelector(sel.finishedMarker),
          notice:
            document
              .querySelector<HTMLElement>(sel.notification)
              ?.innerText.trim() ?? "",
        };
      },
      {
        sel: { ...DEEPSEEK_DOM, sendButton: DEEPSEEK_SELECTORS.sendButton },
        attr: SEEN_ATTR,
      },
    );
  }

  private async challengeVisible(): Promise<boolean> {
    return this.page
      .locator(DEEPSEEK_DOM.challenge)
      .first()
      .isVisible()
      .catch(() => false);
  }
}

/**
 * Active-state marker of a composer toggle. The DOM report only saw toggles that were ON (reasoning
 * and web search were both present) and they all carried `ds-toggle-button--select`, so that class
 * is taken as the active marker; ARIA/data attributes win if the site adds them.
 */
function readToggleState(toggle: Locator): Promise<boolean> {
  return toggle.evaluate((el) => {
    for (const name of ["aria-pressed", "aria-checked", "data-state"]) {
      const value = el.getAttribute(name);
      if (value === "true" || value === "on" || value === "checked")
        return true;
      if (value === "false" || value === "off" || value === "unchecked")
        return false;
    }
    return [...el.classList].some((cls) =>
      /^ds-toggle-button--(select|selected|active|checked)$/.test(cls),
    );
  });
}
