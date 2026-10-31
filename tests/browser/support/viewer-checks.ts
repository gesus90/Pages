import { expect } from "@playwright/test";
import { z } from "zod";

import type { Locator, Page } from "@playwright/test";
import type { SeedImage, SeedTicket } from "./seed";
import type { TicketView } from "./ticket-view";

const ticketAnswer = z.object({
  selection: z.object({
    selectedItem: z.object({
      description: z.string(),
      title: z.string(),
      updatedAt: z.string(),
    }),
  }),
});

/** The stored data of a ticket that opening an image must not change. */
export interface TicketData {
  readonly description: string;
  readonly title: string;
  readonly updatedAt: string;
}

/**
 * Reads the stored data of a ticket from the server.
 *
 * @param page - A page of the signed-in account.
 * @param key - Ticket key.
 * @returns Description, title and time of the last change.
 */
export async function readTicketData(
  page: Page,
  key: string,
): Promise<TicketData> {
  const response = await page.request.get(`/aufgaben-api/panel/${key}`);

  expect(response.status()).toBe(200);

  return ticketAnswer.parse(await response.json()).selection.selectedItem;
}

/** Where a control is on the screen and how far its scroll container is scrolled. */
export interface ScrollState {
  readonly top: number;
  readonly containerScrollTop: number;
  readonly windowScrollY: number;
}

/**
 * Measures where an element sits on the screen and how far its page is scrolled.
 *
 * @param target - The element, usually the control that opened the viewer.
 * @returns Its distance from the top of the window and the scroll offsets.
 */
export async function measureScroll(target: Locator): Promise<ScrollState> {
  return target.evaluate((element) => {
    let container: Element | null = element.parentElement;

    while (container) {
      const overflow = getComputedStyle(container).overflowY;

      if (
        (overflow === "auto" || overflow === "scroll") &&
        container.scrollHeight > container.clientHeight
      ) {
        break;
      }

      container = container.parentElement;
    }

    return {
      containerScrollTop: container?.scrollTop ?? 0,
      top: element.getBoundingClientRect().top,
      windowScrollY: window.scrollY,
    };
  });
}

/**
 * Checks that the viewer shows the image at a position of the list.
 *
 * @param view - The ticket view.
 * @param shown - The image that must be shown, its position and the list size.
 */
export async function expectShown(
  view: TicketView,
  shown: {
    readonly image: SeedImage;
    readonly index: number;
    readonly total: number;
  },
): Promise<void> {
  await expect(view.viewerImage).toHaveAttribute("src", shown.image.path);
  await expect(view.viewerImage).toHaveAccessibleName(shown.image.alt);

  if (shown.total > 1) {
    await expect(view.position).toHaveText(
      `${shown.index + 1} / ${shown.total}`,
    );
  }
}

/**
 * Waits until the viewer's image decoded and reports its natural size.
 *
 * @param view - The ticket view.
 * @returns The natural width and height of the shown image.
 */
export async function waitForShownImage(
  view: TicketView,
): Promise<{ readonly width: number; readonly height: number }> {
  await expect
    .poll(() =>
      view.viewerImage.evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
    )
    .toBe(true);

  return view.viewerImage.evaluate((image: HTMLImageElement) => ({
    height: image.naturalHeight,
    width: image.naturalWidth,
  }));
}

/** What the viewer made of an image: its box and the picture inside it. */
export interface ShownLayout {
  readonly box: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly picture: { readonly width: number; readonly height: number };
  readonly viewport: { readonly width: number; readonly height: number };
}

/**
 * Measures the box of the shown image and the picture `object-fit: contain`
 * draws inside it.
 *
 * @param view - The ticket view.
 * @returns Box, drawn picture and viewport in CSS pixels.
 */
export async function measureShownLayout(
  view: TicketView,
): Promise<ShownLayout> {
  const natural = await waitForShownImage(view);
  const box = await view.viewerImage.boundingBox();
  const viewport = view.page.viewportSize();

  if (!box || !viewport) {
    throw new Error("The viewer image or the viewport has no size.");
  }

  const scale = Math.min(
    box.width / natural.width,
    box.height / natural.height,
  );

  return {
    box,
    picture: { height: natural.height * scale, width: natural.width * scale },
    viewport,
  };
}

/**
 * Returns the fixture image at a position of the ticket's description.
 *
 * @param ticket - The fixture ticket.
 * @param index - Position in the displayed order.
 * @returns The image.
 * @throws {Error} When the ticket has no image there.
 */
export function imageAt(ticket: SeedTicket, index: number): SeedImage {
  const image = ticket.images[index];

  if (!image) {
    throw new Error(`${ticket.key} has no image at ${index}.`);
  }

  return image;
}

/**
 * Reads the addresses of the images the description displays, in displayed
 * order.
 *
 * @param view - The ticket view.
 * @returns The `src` of every viewable image.
 */
export async function displayedSources(view: TicketView): Promise<string[]> {
  return view.description
    .locator("img[data-viewer-image]")
    .evaluateAll((images) =>
      images.map((image) => image.getAttribute("src") ?? ""),
    );
}

/**
 * Checks that the description is not being edited.
 *
 * @param view - The ticket view.
 * @param options - `canEdit` is `false` for a person without the right, who
 * has no edit button to look for.
 *
 * @remarks
 * The editor loads lazily, so its absence right after a click proves nothing:
 * it can appear a moment later. Entering the edit mode, however, replaces the
 * edit button at once and brings Save and Cancel, so those are checked too.
 */
export async function expectNotEditing(
  view: TicketView,
  options: { readonly canEdit?: boolean } = {},
): Promise<void> {
  if (options.canEdit ?? true) {
    await expect(view.editButton).toBeVisible();
  }

  await expect(
    view.description.getByRole("button", { includeHidden: true, name: "Save" }),
  ).toHaveCount(0);
  await expect(view.editor).toHaveCount(0);
}

/** A box on the screen in CSS pixels. */
export interface Rectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Reads the box of an element that must be on the screen.
 *
 * @param target - The element.
 * @returns Its box.
 * @throws {Error} When the element has no box.
 */
export async function boxOf(target: Locator): Promise<Rectangle> {
  const box = await target.boundingBox();

  if (!box) {
    throw new Error("The element has no box.");
  }

  return box;
}

/**
 * Tells whether two boxes cover a common area.
 *
 * @param first - One box.
 * @param second - The other box.
 * @returns Whether they overlap.
 */
export function overlaps(first: Rectangle, second: Rectangle): boolean {
  return (
    first.x < second.x + second.width &&
    second.x < first.x + first.width &&
    first.y < second.y + second.height &&
    second.y < first.y + first.height
  );
}
