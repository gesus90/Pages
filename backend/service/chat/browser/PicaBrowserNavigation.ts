import { logCaughtError } from "@/backend/logging/Logger";

import { PicaAdminError } from "../admin/PicaAdminContracts";
import { settlePage } from "./PicaBrowserObservation";
import { resolveBrowserTarget } from "./PicaBrowserTargets";

import type { Page } from "playwright-core";
import type { z } from "zod";
import type { PICA_BROWSER_SCHEMAS } from "./PicaBrowserContracts";
import type { PicaBrowserOrigins } from "./PicaBrowserTargets";
import type { PicaBrowserSession } from "./PicaBrowserSession";

type NavigateInput = z.infer<typeof PICA_BROWSER_SCHEMAS.browser_navigate>;
type TabsInput = z.infer<typeof PICA_BROWSER_SCHEMAS.browser_tabs>;
type ViewportInput = z.infer<typeof PICA_BROWSER_SCHEMAS.browser_viewport>;
type WaitInput = z.infer<typeof PICA_BROWSER_SCHEMAS.browser_wait>;

const NAVIGATION_TIMEOUT_MS = 20_000;

/**
 * Turns whatever Playwright or the network reported into one stable code.
 *
 * @param session - The browser the call ran in.
 * @param error - The failure.
 * @returns A code that never carries page content or internal messages.
 */
export function browserFailure(
  session: PicaBrowserSession,
  error: unknown,
): PicaAdminError {
  if (error instanceof PicaAdminError) return error;
  if (session.currentState === "stopped")
    return new PicaAdminError("STOPPED_BY_ADMIN");
  const refusal = session.takeRefusal();
  if (refusal) return new PicaAdminError(refusal);
  const message = error instanceof Error ? error.message : "";
  if (error instanceof Error && error.name === "TimeoutError")
    return new PicaAdminError("ACTION_TIMEOUT");
  if (/net::ERR_/u.test(message))
    return new PicaAdminError("NAVIGATION_FAILED");
  if (/has been closed|Target closed/iu.test(message))
    return new PicaAdminError("BROWSER_CLOSED");
  if (
    /not visible|not enabled|intercepts pointer|not attached|detached/iu.test(
      message,
    )
  )
    return new PicaAdminError("ELEMENT_NOT_ACTIONABLE");
  if (/Unknown key|Unsupported key/iu.test(message))
    return new PicaAdminError("INVALID_KEYS");
  logCaughtError("PicaBrowserNavigation", error);
  return new PicaAdminError("BROWSER_ACTION_FAILED");
}

/**
 * Adds the scheme to an address the model wrote without one and checks it against the target policy.
 *
 * @param origins - The origins the browser may reach besides the public internet.
 * @param raw - The address as the model or administrator wrote it.
 * @returns The absolute address.
 * @throws {PicaAdminError} `URL_REQUIRED` or `URL_DENIED`.
 */
export async function checkedAddress(
  origins: PicaBrowserOrigins,
  raw: string | undefined,
): Promise<string> {
  const text = raw?.trim();
  if (!text) throw new PicaAdminError("URL_REQUIRED");
  const address = /^[a-z][a-z0-9+.-]*:/iu.test(text) ? text : `https://${text}`;
  const target = await resolveBrowserTarget(address, origins);
  return target.url.href;
}

async function load(
  session: PicaBrowserSession,
  page: Page,
  address: string,
): Promise<void> {
  const downloads = session.storedDownloads().length;
  try {
    await page.goto(address, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
  } catch (error: unknown) {
    // A download answers with an empty page; the file is kept, the tab stays as it was.
    const isDownload =
      error instanceof Error &&
      /ERR_ABORTED/u.test(error.message) &&
      session.storedDownloads().length > downloads;
    if (!isDownload) throw error;
  }
}

/**
 * Loads an address or moves in the history of the active tab.
 *
 * @param session - The browser.
 * @param input - The validated tool input.
 * @returns A short description for the action log.
 */
export async function navigate(
  session: PicaBrowserSession,
  input: NavigateInput,
): Promise<string> {
  const page = session.activePage();
  if (input.action === "goto") {
    const address = await checkedAddress(session.allowedOrigins(), input.url);
    await load(session, page, address);
    await settlePage(page);
    return `Opened ${new URL(address).host}${new URL(address).pathname}`;
  }
  const move = {
    back: () => page.goBack({ timeout: NAVIGATION_TIMEOUT_MS }),
    forward: () => page.goForward({ timeout: NAVIGATION_TIMEOUT_MS }),
    reload: () => page.reload({ timeout: NAVIGATION_TIMEOUT_MS }),
  } as const;
  await move[input.action]();
  await settlePage(page);
  return `Went ${input.action}`;
}

/**
 * Lists, opens, switches and closes tabs.
 *
 * @param session - The browser.
 * @param input - The validated tool input.
 * @returns A short description for the action log.
 */
export async function manageTabs(
  session: PicaBrowserSession,
  input: TabsInput,
): Promise<string> {
  if (input.action === "list") return "Listed the tabs";
  if (input.action === "open") {
    const address = input.url
      ? await checkedAddress(session.allowedOrigins(), input.url)
      : null;
    const page = await session.requireContext().newPage();
    if (address) await load(session, page, address);
    await settlePage(page);
    return "Opened a new tab";
  }
  if (input.action === "switch") {
    const page = session.activate(input.tab ?? 0);
    await page.bringToFront();
    return `Switched to tab ${input.tab ?? 0}`;
  }
  const pages = session.openPages();
  if (pages.length <= 1) throw new PicaAdminError("LAST_TAB");
  const index =
    input.tab ?? pages.findIndex((page) => page === session.activePage());
  const page = pages[index];
  if (!page) throw new PicaAdminError("TAB_NOT_FOUND");
  await page.close();
  return `Closed tab ${index}`;
}

/**
 * Switches the device preset or resizes the viewport to test another layout.
 *
 * @param session - The browser.
 * @param input - The validated tool input.
 * @returns A short description for the action log.
 */
export async function changeViewport(
  session: PicaBrowserSession,
  input: ViewportInput,
): Promise<string> {
  if (input.device && input.device !== session.currentDevice) {
    const address = await session.changeDevice(input.device);
    if (address.startsWith("http")) {
      await load(
        session,
        session.activePage(),
        await checkedAddress(session.allowedOrigins(), address),
      );
      await settlePage(session.activePage());
    }
    return `Switched to the ${input.device} view`;
  }
  if (input.width !== undefined && input.height !== undefined) {
    await session.resize(input.width, input.height);
    await settlePage(session.activePage());
    return `Resized to ${input.width}x${input.height}`;
  }
  if (input.device) return `Stayed in the ${input.device} view`;
  throw new PicaAdminError("VIEWPORT_REQUIRED");
}

/**
 * Waits for a moment or until some text shows on the page.
 *
 * @param session - The browser.
 * @param input - The validated tool input.
 * @returns A short description for the action log.
 */
export async function waitForPage(
  session: PicaBrowserSession,
  input: WaitInput,
): Promise<string> {
  const page = session.activePage();
  if (input.text) {
    await page
      .getByText(input.text)
      .first()
      .waitFor({ state: "visible", timeout: 10_000 });
    return "Waited for text to appear";
  }
  await page.waitForTimeout((input.seconds ?? 1) * 1000);
  return `Waited ${input.seconds ?? 1} s`;
}
