import { PicaAdminError } from "../admin/PicaAdminContracts";
import { checkedAddress, browserFailure } from "./PicaBrowserNavigation";
import { markTypedScript } from "./PicaBrowserPageScript";

import type { Page } from "playwright-core";
import type { PicaBrowserInput } from "@/definition/PicaBrowser";
import type { PicaBrowserSession } from "./PicaBrowserSession";

const SINGLE_CHARACTER = /^.$/u;

/** What the administrator's input is logged as; typed text itself never reaches the log. */
function describeInput(input: PicaBrowserInput): string {
  switch (input.type) {
    case "click":
      return `Clicked at (${Math.round(input.x)}, ${Math.round(input.y)})`;
    case "scroll":
      return "Scrolled";
    case "text":
      return `Typed ${input.text.length} character(s)`;
    case "key":
      return `Pressed ${input.key}`;
    case "navigate":
      return "Opened an address";
    case "history":
      return `Went ${input.direction}`;
  }
}

/** After the administrator typed, no value of this page's fields may reach a model view. */
async function markTyped(
  session: PicaBrowserSession,
  page: Page,
): Promise<void> {
  session.sensitivePages.add(page);
  await page.evaluate(markTypedScript).catch(() => undefined);
}

async function perform(
  session: PicaBrowserSession,
  input: PicaBrowserInput,
): Promise<void> {
  const page = session.activePage();
  switch (input.type) {
    case "click":
      await page.mouse.click(input.x, input.y, {
        clickCount: input.clicks ?? 1,
      });
      return;
    case "scroll":
      await page.mouse.move(input.x, input.y);
      await page.mouse.wheel(input.deltaX, input.deltaY);
      return;
    case "text":
      await markTyped(session, page);
      await page.keyboard.type(input.text);
      await markTyped(session, page);
      return;
    case "key":
      if (SINGLE_CHARACTER.test(input.key)) await markTyped(session, page);
      await page.keyboard.press(input.key);
      return;
    case "navigate":
      await page.goto(
        await checkedAddress(session.allowedOrigins(), input.url),
        {
          waitUntil: "domcontentloaded",
        },
      );
      return;
    case "history":
      if (input.direction === "back") await page.goBack();
      else if (input.direction === "forward") await page.goForward();
      else await page.reload();
  }
}

/**
 * Applies one input of an administrator who took over the browser.
 *
 * @param session - The browser; its state must be `takeover`.
 * @param input - The validated input.
 * @throws {PicaAdminError} `NOT_IN_TAKEOVER` unless the administrator has the controls.
 *
 * @remarks
 * The input goes straight to the page. It never passes a tool result, the
 * action log or an observation, so a password typed here stays with the page.
 */
export async function applyAdministratorInput(
  session: PicaBrowserSession,
  input: PicaBrowserInput,
): Promise<void> {
  if (session.currentState !== "takeover")
    throw new PicaAdminError("NOT_IN_TAKEOVER");
  await session.queue.run(async () => {
    session.touch();
    try {
      await perform(session, input);
      await session.activePage().waitForTimeout(150);
      session.record("admin", describeInput(input), "completed");
    } catch (error: unknown) {
      session.record("admin", describeInput(input), "failed");
      throw browserFailure(session, error);
    }
  });
}
