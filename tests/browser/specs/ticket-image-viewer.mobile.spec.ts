import { expect, test } from "../support/fixtures";
import { TicketView } from "../support/ticket-view";
import {
  boxOf,
  expectNotEditing,
  expectShown,
  imageAt,
  measureShownLayout,
  overlaps,
} from "../support/viewer-checks";

test("a tap opens the image, taps page through and close, and the tap target returns", async ({
  page,
  seed,
  writes,
}) => {
  const view = new TicketView(page, seed.gallery, "page");

  await view.open();
  await view.loadAllImages();
  const trigger = view.imageButtons.nth(1);

  await trigger.tap();
  await expectShown(view, {
    image: imageAt(seed.gallery, 1),
    index: 1,
    total: 5,
  });
  await expectNotEditing(view);

  await view.nextButton.tap();
  await expectShown(view, {
    image: imageAt(seed.gallery, 2),
    index: 2,
    total: 5,
  });
  await view.previousButton.tap();
  await view.previousButton.tap();
  await expectShown(view, {
    image: imageAt(seed.gallery, 0),
    index: 0,
    total: 5,
  });
  await expect(view.previousButton).toBeDisabled();

  await view.closeButton.tap();
  await expect(view.viewer).toBeHidden();
  await expect(trigger).toBeFocused();
  await expectNotEditing(view);
  expect(writes.requests).toEqual([]);
});

test("on a narrow screen the controls are large enough and cover none of the picture", async ({
  page,
  seed,
}) => {
  const view = new TicketView(page, seed.gallery, "page");

  await view.open();
  await view.loadAllImages();
  await view.imageButtons.nth(1).tap();
  await expectShown(view, {
    image: imageAt(seed.gallery, 1),
    index: 1,
    total: 5,
  });

  const layout = await measureShownLayout(view);
  const controls = {
    close: await boxOf(view.closeButton),
    next: await boxOf(view.nextButton),
    previous: await boxOf(view.previousButton),
  };

  for (const box of Object.values(controls)) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(layout.viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(layout.viewport.height);
    expect(overlaps(box, layout.box)).toBe(false);
  }

  expect(overlaps(controls.previous, controls.next)).toBe(false);
  expect(layout.box.x).toBeGreaterThanOrEqual(0);
  expect(layout.box.x + layout.box.width).toBeLessThanOrEqual(
    layout.viewport.width,
  );
  expect(layout.picture.width / layout.picture.height).toBeCloseTo(
    imageAt(seed.gallery, 1).width / imageAt(seed.gallery, 1).height,
    2,
  );

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

  expect(overflow).toBeLessThanOrEqual(0);
});

test("a single image on a narrow screen has no arrows and uses the whole area", async ({
  page,
  seed,
}) => {
  const view = new TicketView(page, seed.single, "page");

  await view.open();
  await view.imageButtons.first().tap();
  await expectShown(view, {
    image: imageAt(seed.single, 0),
    index: 0,
    total: 1,
  });

  await expect(view.previousButton).toHaveCount(0);
  await expect(view.nextButton).toHaveCount(0);

  const layout = await measureShownLayout(view);

  expect(layout.box.height).toBeGreaterThan(layout.viewport.height * 0.8);
});
