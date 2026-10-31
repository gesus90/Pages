import { expect, test } from "../support/fixtures";
import { TicketView } from "../support/ticket-view";
import {
  boxOf,
  displayedSources,
  expectNotEditing,
  expectShown,
  imageAt,
  measureScroll,
  measureShownLayout,
  overlaps,
  readTicketData,
} from "../support/viewer-checks";

import type { TicketSurface } from "../support/ticket-view";

const SURFACES: readonly TicketSurface[] = ["page", "dialog"];

test("the original defect: a click on an image does not start editing the description", async ({
  page,
  seed,
  writes,
}) => {
  const view = new TicketView(page, seed.gallery, "page");

  await view.open();
  // The image itself, not a control around it: this is what a person clicks.
  await view.description.locator("img").nth(1).click();

  await expectNotEditing(view);
  await expect(view.viewer).toBeVisible();
  await expectShown(view, {
    image: imageAt(seed.gallery, 1),
    index: 1,
    total: 5,
  });
  expect(writes.requests).toEqual([]);
});

for (const surface of SURFACES) {
  test(`a click on a middle image opens exactly that image and not the editor (${surface})`, async ({
    page,
    seed,
    writes,
  }) => {
    const view = new TicketView(page, seed.gallery, surface);
    const before = await readTicketData(page, seed.gallery.key);

    await view.open();
    await expect(view.imageButtons).toHaveCount(5);
    await view.imageButtons.nth(2).click();

    await expect(view.viewer).toBeVisible();
    await expectShown(view, {
      image: imageAt(seed.gallery, 2),
      index: 2,
      total: 5,
    });
    await expectNotEditing(view);
    await expect(view.editButton).toBeVisible();
    expect(writes.requests).toEqual([]);
    expect(await readTicketData(page, seed.gallery.key)).toEqual(before);
  });
}

test("the viewer pages through the images in the displayed order with the arrows", async ({
  page,
  seed,
  writes,
}) => {
  const view = new TicketView(page, seed.gallery, "page");

  await view.open();
  expect(await displayedSources(view)).toEqual(
    seed.gallery.images.map((image) => image.path),
  );
  await view.imageButtons.first().click();

  await expectShown(view, {
    image: imageAt(seed.gallery, 0),
    index: 0,
    total: 5,
  });
  await expect(view.previousButton).toBeDisabled();
  await expect(view.nextButton).toBeEnabled();

  for (let index = 1; index < 5; index += 1) {
    await view.nextButton.click();
    await expectShown(view, {
      image: imageAt(seed.gallery, index),
      index,
      total: 5,
    });
  }

  await expect(view.nextButton).toBeDisabled();
  await expect(view.previousButton).toBeEnabled();
  await view.previousButton.click();
  await expectShown(view, {
    image: imageAt(seed.gallery, 3),
    index: 3,
    total: 5,
  });
  expect(writes.requests).toEqual([]);
});

test("the arrow keys page through the images and stop at both ends", async ({
  page,
  seed,
  writes,
}) => {
  const view = new TicketView(page, seed.gallery, "page");

  await view.open();
  await view.imageButtons.first().click();

  await page.keyboard.press("ArrowLeft");
  await expectShown(view, {
    image: imageAt(seed.gallery, 0),
    index: 0,
    total: 5,
  });

  for (let index = 1; index < 5; index += 1) {
    await page.keyboard.press("ArrowRight");
    await expectShown(view, {
      image: imageAt(seed.gallery, index),
      index,
      total: 5,
    });
  }

  await page.keyboard.press("ArrowRight");
  await expectShown(view, {
    image: imageAt(seed.gallery, 4),
    index: 4,
    total: 5,
  });
  await page.keyboard.press("ArrowLeft");
  await expectShown(view, {
    image: imageAt(seed.gallery, 3),
    index: 3,
    total: 5,
  });
  expect(writes.requests).toEqual([]);
});

test("the focus stays in the viewer when the used arrow turns unavailable", async ({
  page,
  seed,
}) => {
  const view = new TicketView(page, seed.gallery, "page");

  await view.open();
  await view.imageButtons.nth(3).click();
  await view.nextButton.click();
  await expect(view.nextButton).toBeDisabled();

  await page.keyboard.press("ArrowLeft");
  await expectShown(view, {
    image: imageAt(seed.gallery, 3),
    index: 3,
    total: 5,
  });
  expect(
    await view.viewer.evaluate((dialog) =>
      dialog.contains(document.activeElement),
    ),
  ).toBe(true);
});

test("a ticket with one image has no navigation", async ({
  page,
  seed,
  writes,
}) => {
  const view = new TicketView(page, seed.single, "page");

  await view.open();
  await view.imageButtons.click();

  await expectShown(view, {
    image: imageAt(seed.single, 0),
    index: 0,
    total: 1,
  });
  await expect(view.previousButton).toHaveCount(0);
  await expect(view.nextButton).toHaveCount(0);
  await expect(view.position).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expectShown(view, {
    image: imageAt(seed.single, 0),
    index: 0,
    total: 1,
  });
  await page.keyboard.press("Escape");
  await expect(view.viewer).toBeHidden();
  expect(writes.requests).toEqual([]);
});

for (const surface of SURFACES) {
  for (const closing of ["Escape", "close button"] as const) {
    test(`closing with ${closing} restores view, focus and scroll position (${surface})`, async ({
      page,
      seed,
      writes,
    }) => {
      const view = new TicketView(page, seed.gallery, surface);
      const before = await readTicketData(page, seed.gallery.key);

      await view.open();
      await view.loadAllImages();
      const trigger = view.imageButtons.nth(3);

      // Centered, so the click scrolls nothing further before it is measured.
      await trigger.evaluate((element) =>
        element.scrollIntoView({ block: "center" }),
      );
      const scrolled = await measureScroll(trigger);

      expect(
        scrolled.containerScrollTop + scrolled.windowScrollY,
      ).toBeGreaterThan(0);
      await trigger.click();
      await view.nextButton.click();
      await expectShown(view, {
        image: imageAt(seed.gallery, 4),
        index: 4,
        total: 5,
      });

      if (closing === "Escape") {
        await page.keyboard.press("Escape");
      } else {
        await view.closeButton.click();
      }

      await expect(view.viewer).toBeHidden();
      await expect(trigger).toBeFocused();
      expect(await measureScroll(trigger)).toEqual(scrolled);
      await expectNotEditing(view);
      await expect(view.description).toBeVisible();
      expect(writes.requests).toEqual([]);
      expect(await readTicketData(page, seed.gallery.key)).toEqual(before);
    });
  }
}

test("Escape closes only the viewer, then the ticket dialog", async ({
  page,
  seed,
}) => {
  const view = new TicketView(page, seed.gallery, "dialog");

  await view.open();
  await view.imageButtons.nth(1).click();
  await expect(view.viewer).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(view.viewer).toBeHidden();
  await expect(view.root).toBeVisible();
  expect(page.url()).toContain(`item=${seed.gallery.key}`);

  await page.keyboard.press("Escape");
  await expect(view.root).toBeHidden();
  expect(page.url()).not.toContain("item=");
});

test("the viewer covers the ticket and keeps the focus inside while it is open", async ({
  page,
  seed,
}) => {
  const view = new TicketView(page, seed.gallery, "dialog");

  await view.open();
  await view.imageButtons.nth(0).click();
  await expect(view.viewer).toBeVisible();

  const isCovered = await view.viewer.evaluate((dialog) =>
    [
      [5, 5],
      [innerWidth / 2, innerHeight / 2],
      [innerWidth - 5, innerHeight - 5],
    ].every(([x, y]) =>
      dialog.contains(document.elementFromPoint(x ?? 0, y ?? 0)),
    ),
  );

  expect(isCovered).toBe(true);

  for (let press = 0; press < 8; press += 1) {
    await page.keyboard.press("Tab");
    expect(
      await view.viewer.evaluate((dialog) =>
        dialog.contains(document.activeElement),
      ),
    ).toBe(true);
  }
});

test("the explicit edit action and a click into the text still open the editor", async ({
  page,
  seed,
}) => {
  const view = new TicketView(page, seed.editing, "page");
  const before = await readTicketData(page, seed.editing.key);

  await view.open();
  await view.imageButtons.click();
  await expect(view.viewer).toBeVisible();
  await expectNotEditing(view);
  await page.keyboard.press("Escape");
  await expect(view.viewer).toBeHidden();
  await expectNotEditing(view);

  await view.editButton.click();
  await expect(view.editor).toBeVisible();
  await expect(view.viewer).toBeHidden();
  await view.description.getByRole("button", { name: "Cancel" }).click();
  await expectNotEditing(view);

  await view.description.getByText("Synthetic fixture ticket.").click();
  await expect(view.editor).toBeVisible();
  await view.description.getByRole("button", { name: "Cancel" }).click();
  await expectNotEditing(view);
  expect(await readTicketData(page, seed.editing.key)).toEqual(before);
});

test("the image is shown as large as possible, whole and in proportion", async ({
  page,
  seed,
}) => {
  const view = new TicketView(page, seed.gallery, "page");

  await view.open();
  await view.imageButtons.first().click();
  await expect(view.viewerImage).toHaveCSS("object-fit", "contain");

  for (const [index, image] of seed.gallery.images.entries()) {
    if (index > 0) {
      await view.nextButton.click();
    }

    await expectShown(view, { image, index, total: 5 });

    const layout = await measureShownLayout(view);
    const { box, picture, viewport } = layout;

    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(picture.width / picture.height).toBeCloseTo(
      image.width / image.height,
      2,
    );
    // Whole and large: the picture reaches the box in width or in height.
    expect(
      Math.max(picture.width / box.width, picture.height / box.height),
    ).toBeGreaterThan(0.99);
    expect(picture.width).toBeLessThanOrEqual(box.width + 0.5);
    expect(picture.height).toBeLessThanOrEqual(box.height + 0.5);
  }

  // The arrows sit beside the picture, level with it, and cover none of it.
  const box = (await measureShownLayout(view)).box;

  for (const arrow of [view.previousButton, view.nextButton]) {
    const arrowBox = await boxOf(arrow);
    const middle = arrowBox.y + arrowBox.height / 2;

    expect(overlaps(arrowBox, box)).toBe(false);
    expect(middle).toBeGreaterThan(box.y);
    expect(middle).toBeLessThan(box.y + box.height);
  }

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

  expect(overflow).toBeLessThanOrEqual(0);
});

test("the viewer names itself and its controls for assistive technology", async ({
  page,
  seed,
}) => {
  const view = new TicketView(page, seed.gallery, "page");

  await view.open();
  await view.imageButtons.nth(1).click();

  await expect(view.viewer).toBeVisible();
  await expect(view.closeButton).toBeVisible();
  await expect(view.previousButton).toBeVisible();
  await expect(view.nextButton).toBeVisible();
  await expect(view.viewerImage).toHaveAccessibleName("Portrait chart");
  await expect(view.viewer).toMatchAriaSnapshot(`
    - dialog "Image viewer":
      - heading "Image viewer" [level=2]
      - status: 2 / 5
      - paragraph: Portrait chart
      - button "Close image viewer"
      - button "Previous image"
      - button "Next image"
      - img "Portrait chart"
  `);
  // The page behind is hidden from assistive technology while the viewer is open.
  expect(
    await page.locator("body > [aria-hidden='true']").count(),
  ).toBeGreaterThan(0);
});
