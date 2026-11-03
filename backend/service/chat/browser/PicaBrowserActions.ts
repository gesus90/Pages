import { PicaAdminError } from "../admin/PicaAdminContracts";
import { settlePage } from "./PicaBrowserObservation";
import {
  activeIsSecretScript,
  resolveScript,
  scrollElementScript,
} from "./PicaBrowserPageScript";

import type { ElementHandle } from "playwright-core";
import type { z } from "zod";
import type {
  PICA_BROWSER_SCHEMAS,
  PicaBrowserPoint,
} from "./PicaBrowserContracts";
import type { PicaBrowserSession } from "./PicaBrowserSession";

type ClickInput = z.infer<typeof PICA_BROWSER_SCHEMAS.browser_click>;
type PressInput = z.infer<typeof PICA_BROWSER_SCHEMAS.browser_press>;
type ScrollInput = z.infer<typeof PICA_BROWSER_SCHEMAS.browser_scroll>;
type DragInput = z.infer<typeof PICA_BROWSER_SCHEMAS.browser_drag>;

/** An element of the page, as Playwright hands it out. */
export type PicaBrowserElement = ElementHandle<Element>;

/** A place on the page: viewport coordinates, and the element when the model named one. */
export interface PicaBrowserPlace {
  readonly x: number;
  readonly y: number;
  readonly element: PicaBrowserElement | null;
}

const DEFAULT_SCROLL_PIXELS = 600;
const SINGLE_CHARACTER_KEY = /^(?:[A-Za-z0-9]|Digit\d|Key[A-Z]|Space)$/u;

const DIRECTIONS: Readonly<
  Record<ScrollInput["direction"], { readonly x: number; readonly y: number }>
> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * Finds the element a reference of the last observation stands for.
 *
 * @param session - The browser.
 * @param ref - The reference, such as `e12`.
 * @returns The live element.
 * @throws {PicaAdminError} `STALE_REF` when the page changed since that observation.
 */
export async function locateElement(
  session: PicaBrowserSession,
  ref: string,
): Promise<PicaBrowserElement> {
  const handle = await session
    .activePage()
    .evaluateHandle(resolveScript, { key: session.referenceKey, ref });
  const element = handle.asElement();
  if (!element) {
    await handle.dispose();
    throw new PicaAdminError("STALE_REF");
  }
  return element;
}

/** A readable name of an element for the action log. */
export function labelOf(session: PicaBrowserSession, ref: string): string {
  return `${ref} (${session.elementNames.get(ref) ?? "element"})`;
}

/**
 * Resolves a reference or a pair of coordinates to a point inside the viewport.
 *
 * @param session - The browser.
 * @param point - What the model named.
 * @returns The center of the element, or the coordinates as given.
 * @throws {PicaAdminError} `TARGET_REQUIRED`, `STALE_REF` or `ELEMENT_NOT_ACTIONABLE`.
 */
export async function resolvePlace(
  session: PicaBrowserSession,
  point: PicaBrowserPoint,
): Promise<PicaBrowserPlace> {
  if (point.ref) {
    const element = await locateElement(session, point.ref);
    await element.scrollIntoViewIfNeeded({ timeout: 3000 });
    const box = await element.boundingBox();
    if (!box) throw new PicaAdminError("ELEMENT_NOT_ACTIONABLE");
    return {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      element,
    };
  }
  if (point.x === undefined || point.y === undefined)
    throw new PicaAdminError("TARGET_REQUIRED");
  return { x: point.x, y: point.y, element: null };
}

/**
 * Clicks or double-clicks an element or a point of the screenshot.
 *
 * @param session - The browser.
 * @param input - The validated tool input.
 * @returns A short description for the action log.
 */
export async function click(
  session: PicaBrowserSession,
  input: ClickInput,
): Promise<string> {
  const button = input.button ?? "left";
  session.dialogAnswer = input.dialog ?? null;
  try {
    if (input.ref) {
      const element = await locateElement(session, input.ref);
      const options = { button, timeout: 6000 } as const;
      if (input.double) await element.dblclick(options);
      else await element.click(options);
    } else {
      const place = await resolvePlace(session, input);
      await session.activePage().mouse.click(place.x, place.y, {
        button,
        clickCount: input.double ? 2 : 1,
      });
    }
    await settlePage(session.activePage());
  } finally {
    session.dialogAnswer = null;
  }
  const where = input.ref
    ? labelOf(session, input.ref)
    : `(${input.x ?? "?"}, ${input.y ?? "?"})`;
  return `${input.double ? "Double-clicked" : "Clicked"} ${where}`;
}

/**
 * Moves the pointer over an element or a point, for menus and tooltips.
 *
 * @param session - The browser.
 * @param input - The validated tool input.
 * @returns A short description for the action log.
 */
export async function hover(
  session: PicaBrowserSession,
  input: PicaBrowserPoint,
): Promise<string> {
  const place = await resolvePlace(session, input);
  await session.activePage().mouse.move(place.x, place.y, { steps: 4 });
  await session.activePage().waitForTimeout(250);
  return `Hovered ${input.ref ? labelOf(session, input.ref) : `(${place.x}, ${place.y})`}`;
}

/**
 * Presses a key or key combination in the focused element.
 *
 * @param session - The browser.
 * @param input - The validated tool input.
 * @returns A short description for the action log.
 * @throws {PicaAdminError} `CREDENTIAL_DENIED` for a single character into a secret field.
 */
export async function press(
  session: PicaBrowserSession,
  input: PressInput,
): Promise<string> {
  const page = session.activePage();
  // Spelling a password key by key would pass the text check of typing.
  if (
    SINGLE_CHARACTER_KEY.test(input.keys) &&
    (await page.evaluate(activeIsSecretScript))
  )
    throw new PicaAdminError("CREDENTIAL_DENIED");
  session.dialogAnswer = input.dialog ?? null;
  try {
    await page.keyboard.press(input.keys);
    await settlePage(page);
  } finally {
    session.dialogAnswer = null;
  }
  return `Pressed ${input.keys}`;
}

/**
 * Scrolls the page or one element of it.
 *
 * @param session - The browser.
 * @param input - The validated tool input.
 * @returns A short description for the action log.
 */
export async function scroll(
  session: PicaBrowserSession,
  input: ScrollInput,
): Promise<string> {
  const amount = input.amount ?? DEFAULT_SCROLL_PIXELS;
  const deltaX = DIRECTIONS[input.direction].x * amount;
  const deltaY = DIRECTIONS[input.direction].y * amount;
  const page = session.activePage();
  if (input.ref) {
    const element = await locateElement(session, input.ref);
    await element.evaluate(scrollElementScript, { deltaX, deltaY });
  } else {
    const viewport = page.viewportSize();
    await page.mouse.move(
      (viewport?.width ?? 800) / 2,
      (viewport?.height ?? 600) / 2,
    );
    await page.mouse.wheel(deltaX, deltaY);
  }
  await page.waitForTimeout(300);
  return `Scrolled ${input.direction} by ${amount}`;
}

/**
 * Drags from one place to another with real pointer events.
 *
 * @param session - The browser.
 * @param input - The validated tool input.
 * @returns A short description for the action log.
 */
export async function drag(
  session: PicaBrowserSession,
  input: DragInput,
): Promise<string> {
  const from = await resolvePlace(session, input.from);
  const to = await resolvePlace(session, input.to);
  const { mouse } = session.activePage();
  await mouse.move(from.x, from.y);
  await mouse.down();
  await mouse.move(to.x, to.y, { steps: 12 });
  await mouse.up();
  await settlePage(session.activePage());
  return "Dragged and dropped";
}
