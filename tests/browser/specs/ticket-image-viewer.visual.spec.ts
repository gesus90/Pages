import path from "node:path";

import { expect, test } from "../support/fixtures";
import { TicketView } from "../support/ticket-view";
import { imageAt, waitForShownImage } from "../support/viewer-checks";

import type { Page } from "@playwright/test";
import type { SeedTicket } from "../support/seed";

const STYLE_PATH = path.join(
  import.meta.dirname,
  "../support/viewer-visual.css",
);

interface ViewerShot {
  readonly ticket: SeedTicket;
  /** Position of the image that opens the viewer. */
  readonly index: number;
  /** File name of the screenshot without extension. */
  readonly name: string;
}

async function openViewer(page: Page, shot: ViewerShot): Promise<TicketView> {
  const view = new TicketView(page, shot.ticket, "page");

  await view.open();
  await view.loadAllImages();
  await view.imageButtons.nth(shot.index).click();
  await expect(view.viewer).toBeVisible();
  // Out of the way, so no control shows its hover state.
  await page.mouse.move(0, 0);

  return view;
}

async function expectScreenshot(page: Page, name: string): Promise<void> {
  await expect(page).toHaveScreenshot(`${name}.png`, { stylePath: STYLE_PATH });
}

test("single landscape image without navigation", async ({ page, seed }) => {
  const view = await openViewer(page, {
    index: 0,
    name: "single",
    ticket: seed.single,
  });

  await waitForShownImage(view);
  await expectScreenshot(page, "single-landscape");
});

test("first of five images: previous is unavailable", async ({
  page,
  seed,
}) => {
  const view = await openViewer(page, {
    index: 0,
    name: "first",
    ticket: seed.gallery,
  });

  await waitForShownImage(view);
  await expect(view.previousButton).toBeDisabled();
  await expectScreenshot(page, "gallery-first-landscape");
});

test("second of five images: a portrait image", async ({ page, seed }) => {
  const view = await openViewer(page, {
    index: 1,
    name: "portrait",
    ticket: seed.gallery,
  });

  await waitForShownImage(view);
  await expectScreenshot(page, "gallery-second-portrait");
});

test("fourth of five images: a large image scaled down", async ({
  page,
  seed,
}) => {
  const view = await openViewer(page, {
    index: 3,
    name: "large",
    ticket: seed.gallery,
  });

  await waitForShownImage(view);
  await expectScreenshot(page, "gallery-fourth-large");
});

test("last of five images: next is unavailable", async ({ page, seed }) => {
  const view = await openViewer(page, {
    index: 4,
    name: "last",
    ticket: seed.gallery,
  });

  await waitForShownImage(view);
  await expect(view.nextButton).toBeDisabled();
  await expectScreenshot(page, "gallery-last-panorama");
});

test("image inside a link offers the link target", async ({ page, seed }) => {
  const view = new TicketView(page, seed.linked, "page");

  await view.open();
  await view.description.getByRole("img", { name: "Linked chart" }).click();
  await expect(view.viewer).toBeVisible();
  await waitForShownImage(view);
  await page.mouse.move(0, 0);
  await expectScreenshot(page, "linked-image");
});

test("deleted attachment shows the error and keeps the controls", async ({
  page,
  seed,
}) => {
  const view = await openViewer(page, {
    index: 1,
    name: "missing",
    ticket: seed.missing,
  });

  await expect(view.viewer.getByRole("alert")).toBeVisible();
  await expectScreenshot(page, "attachment-deleted");
});

test("image that is still loading shows a spinner", async ({ page, seed }) => {
  const view = new TicketView(page, seed.gallery, "page");
  const target = imageAt(seed.gallery, 2);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await view.open();
  await view.loadAllImages();
  await page.route(`**${target.path}`, async (route) => {
    await gate;
    await route.continue();
  });
  await view.imageButtons.nth(2).click();
  await expect(view.viewer.getByText("Loading image …")).toBeAttached();
  await page.mouse.move(0, 0);
  await expectScreenshot(page, "image-loading");
  release();
  await waitForShownImage(view);
});

test("keyboard focus is visible on the control that holds it", async ({
  page,
  seed,
}) => {
  const view = new TicketView(page, seed.gallery, "page");

  await view.open();
  await view.loadAllImages();
  await view.imageButtons.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(view.viewer).toBeVisible();
  await expect(view.closeButton).toBeFocused();
  await waitForShownImage(view);
  await page.mouse.move(0, 0);
  await expectScreenshot(page, "keyboard-focus");
});

test("the description shows its images as before, now as controls", async ({
  page,
  seed,
}) => {
  const view = new TicketView(page, seed.linked, "page");

  await view.open();
  await view.loadAllImages();
  await page.mouse.move(0, 0);
  await expect(view.description).toHaveScreenshot(
    "description-with-images.png",
  );
});
