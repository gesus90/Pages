import { expect, test } from "../support/fixtures";
import { INSTANCE_ORIGIN } from "../support/paths";
import { TicketView } from "../support/ticket-view";
import {
  expectNotEditing,
  expectShown,
  imageAt,
  waitForShownImage,
} from "../support/viewer-checks";

import type { Page } from "@playwright/test";

/** Collects the pages the browser opens in new tabs. */
function collectPopups(page: Page): Page[] {
  const popups: Page[] = [];

  page.context().on("page", (popup) => popups.push(popup));

  return popups;
}

test("an image inside a link opens the viewer without following the link or editing", async ({
  page,
  seed,
  writes,
}) => {
  const view = new TicketView(page, seed.linked, "page");
  const popups = collectPopups(page);

  await view.open();
  await view.description.getByRole("img", { name: "Linked chart" }).click();

  await expect(view.viewer).toBeVisible();
  await expectShown(view, {
    image: imageAt(seed.linked, 0),
    index: 0,
    total: 2,
  });
  expect(page.url()).toBe(`${INSTANCE_ORIGIN}/aufgaben/${seed.linked.key}`);
  await expectNotEditing(view);
  expect(popups).toHaveLength(0);
  await expect(
    view.viewer.getByRole("link", { name: "Open linked target in a new tab" }),
  ).toHaveAttribute("href", "/aufgaben/VIEW-1");

  await page.keyboard.press("Escape");
  await expect(view.viewer).toBeHidden();
  await expect(
    view.description.getByRole("link", { name: "Linked chart" }),
  ).toBeFocused();
  expect(page.url()).toBe(`${INSTANCE_ORIGIN}/aufgaben/${seed.linked.key}`);
  expect(writes.requests).toEqual([]);
});

test("the plain image of the same ticket pages back to the linked image", async ({
  page,
  seed,
}) => {
  const view = new TicketView(page, seed.linked, "page");

  await view.open();
  await view.description
    .getByRole("button", { name: "Open image: Plain chart" })
    .click();
  await expectShown(view, {
    image: imageAt(seed.linked, 1),
    index: 1,
    total: 2,
  });

  await view.previousButton.click();
  await expectShown(view, {
    image: imageAt(seed.linked, 0),
    index: 0,
    total: 2,
  });
  await expect(
    view.viewer.getByRole("link", { name: "Open linked target in a new tab" }),
  ).toBeVisible();
});

test("ordinary links of the description keep working and open no viewer", async ({
  page,
  seed,
}) => {
  const view = new TicketView(page, seed.linked, "page");
  const popups = collectPopups(page);

  await page
    .context()
    .route("https://example.test/**", (route) =>
      route.fulfill({ body: "target", contentType: "text/plain" }),
    );
  await view.open();

  await view.description.getByRole("link", { name: "external link" }).click();
  await expect.poll(() => popups.length).toBe(1);
  expect(popups[0]?.url()).toBe("https://example.test/target");
  await expect(view.viewer).toHaveCount(0);
  await expectNotEditing(view);

  await view.description.getByRole("link", { name: "Ordinary link" }).click();
  await expect(page).toHaveURL(`${INSTANCE_ORIGIN}/aufgaben/VIEW-1`);
  await expect(view.viewer).toHaveCount(0);
});

test("the link of a linked image opens from the viewer in a new tab", async ({
  page,
  seed,
}) => {
  const view = new TicketView(page, seed.linked, "page");
  const popups = collectPopups(page);

  await view.open();
  await view.description.getByRole("img", { name: "Linked chart" }).click();
  await view.viewer
    .getByRole("link", { name: "Open linked target in a new tab" })
    .click();

  await expect.poll(() => popups.length).toBe(1);
  expect(popups[0]?.url()).toBe(`${INSTANCE_ORIGIN}/aufgaben/VIEW-1`);
  await expect(view.viewer).toBeVisible();
});

test("a deleted attachment shows an error while the other images stay reachable", async ({
  page,
  seed,
  writes,
}) => {
  const view = new TicketView(page, seed.missing, "page");

  await view.open();
  await view.imageButtons.first().click();
  await expectShown(view, {
    image: imageAt(seed.missing, 0),
    index: 0,
    total: 3,
  });
  await waitForShownImage(view);

  await view.nextButton.click();
  const failure = view.viewer.getByRole("alert");

  await expect(failure).toContainText("The image could not be loaded.");
  await expect(failure).toContainText("Deleted chart");
  await expect(view.viewerImage).toHaveCount(0);
  await expect(view.position).toHaveText("2 / 3");
  await expect(view.previousButton).toBeEnabled();
  await expect(view.nextButton).toBeEnabled();
  await expect(view.closeButton).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expectShown(view, {
    image: imageAt(seed.missing, 2),
    index: 2,
    total: 3,
  });
  await expect(failure).toHaveCount(0);
  await waitForShownImage(view);

  await page.keyboard.press("ArrowLeft");
  await expect(failure).toContainText("Deleted chart");
  await page.keyboard.press("Escape");
  await expect(view.viewer).toBeHidden();
  expect(writes.requests).toEqual([]);
});

test("a slow image shows that it is loading and then the image", async ({
  page,
  seed,
}) => {
  const view = new TicketView(page, seed.gallery, "page");
  const target = imageAt(seed.gallery, 1);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let isHeld = false;

  await view.open();
  await view.loadAllImages();
  // The first request of this address was the page's own; the viewer's is held.
  await page.route(`**${target.path}`, async (route) => {
    isHeld = true;
    await gate;
    await route.continue();
  });

  await view.imageButtons.nth(1).click();
  await expect(view.viewer.getByText("Loading image …")).toBeAttached();
  await expect(view.closeButton).toBeVisible();
  release();
  await expect(view.viewer.getByText("Loading image …")).toHaveCount(0);
  await waitForShownImage(view);
  expect(isHeld).toBe(true);
});

test("the attachment route stays protected: without a session nothing is served", async ({
  playwright,
  seed,
}) => {
  // An explicit empty state: the runner would otherwise hand over the session.
  const anonymous = await playwright.request.newContext({
    baseURL: INSTANCE_ORIGIN,
    storageState: { cookies: [], origins: [] },
  });
  const response = await anonymous.get(imageAt(seed.single, 0).path, {
    maxRedirects: 0,
  });

  expect(response.status()).toBe(302);
  expect(response.headers().location).toBe("/login");
  expect(response.headers()["content-type"] ?? "").not.toContain("image/");
  await anonymous.dispose();
});

test("the viewer loads the image from the protected attachment route only", async ({
  page,
  seed,
}) => {
  const view = new TicketView(page, seed.gallery, "page");
  const requested: string[] = [];

  page.on("request", (request) => {
    if (request.resourceType() === "image") {
      requested.push(new URL(request.url()).pathname);
    }
  });
  await view.open();
  await view.imageButtons.nth(2).click();
  await waitForShownImage(view);

  const shown = await view.viewerImage.getAttribute("src");

  expect(shown).toBe(imageAt(seed.gallery, 2).path);
  expect(
    requested.every(
      (path) =>
        path.startsWith("/aufgaben/attachments/") ||
        !path.includes("attachments"),
    ),
  ).toBe(true);
  expect(
    await view.viewerImage.evaluate(
      (image: HTMLImageElement) => image.currentSrc,
    ),
  ).toBe(`${INSTANCE_ORIGIN}${imageAt(seed.gallery, 2).path}`);
});
