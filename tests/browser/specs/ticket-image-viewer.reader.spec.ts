import { expect, test } from "../support/fixtures";
import { INSTANCE_ORIGIN } from "../support/paths";
import { TicketView } from "../support/ticket-view";
import {
  expectNotEditing,
  expectShown,
  imageAt,
} from "../support/viewer-checks";

test.use({ account: "reader" });

test("a person who may only read the ticket can look at and page through its images", async ({
  page,
  seed,
  writes,
}) => {
  const view = new TicketView(page, seed.gallery, "page");

  await view.open();
  await expect(view.editButton).toHaveCount(0);
  await expect(
    page.getByRole("button", { exact: true, name: "Edit" }),
  ).toBeDisabled();

  // A click into the text does not open an editor for a reader either.
  await view.description.getByText("This paragraph only makes").first().click();
  await expectNotEditing(view, { canEdit: false });

  await view.imageButtons.nth(1).click();
  await expectShown(view, {
    image: imageAt(seed.gallery, 1),
    index: 1,
    total: 5,
  });
  await view.nextButton.click();
  await expectShown(view, {
    image: imageAt(seed.gallery, 2),
    index: 2,
    total: 5,
  });
  await page.keyboard.press("ArrowLeft");
  await expectShown(view, {
    image: imageAt(seed.gallery, 1),
    index: 1,
    total: 5,
  });
  await page.keyboard.press("Escape");

  await expect(view.viewer).toBeHidden();
  await expect(view.imageButtons.nth(1)).toBeFocused();
  expect(writes.requests).toEqual([]);
});

test("the reader really has no write right, so the viewer needs none", async ({
  page,
  seed,
}) => {
  const ticket = await page.request.get(
    `/aufgaben-api/panel/${seed.gallery.key}`,
  );
  const body = (await ticket.json()) as {
    selection: { selectedItem: { id: string; updatedAt: string } };
  };
  const { id, updatedAt } = body.selection.selectedItem;
  const attempt = await page.request.post(`/ticket-api/drafts/${id}`, {
    data: {
      base: { description: "", updatedAt },
      draft: { description: "changed by a reader", updatedAt },
      sequence: 1,
      streamId: "00000000-0000-4000-8000-000000000000",
    },
  });

  expect(attempt.status()).toBe(403);
});

test("an attachment of a ticket the reader cannot see stays closed in the viewer", async ({
  page,
  seed,
  writes,
}) => {
  const view = new TicketView(page, seed.hidden, "page");
  const hidden = imageAt(seed.hidden, 1);

  await view.open();
  await expect(view.imageButtons).toHaveCount(3);

  const response = page.waitForResponse(
    (candidate) =>
      candidate.url().endsWith(hidden.path) &&
      candidate.request().resourceType() === "image",
  );

  await view.imageButtons.nth(1).click();
  expect((await response).status()).toBe(404);
  await expect(view.viewer.getByRole("alert")).toContainText(
    "The image could not be loaded.",
  );
  // The viewer asked for the protected route, not for a copy somewhere else.
  const requested = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => entry.name),
  );
  const hiddenRequests = requested.filter((address) =>
    address.includes(seed.hiddenAttachmentId),
  );

  expect(hiddenRequests.length).toBeGreaterThan(0);
  expect(new Set(hiddenRequests)).toEqual(
    new Set([`${INSTANCE_ORIGIN}${hidden.path}`]),
  );

  await view.nextButton.click();
  await expectShown(view, {
    image: imageAt(seed.hidden, 2),
    index: 2,
    total: 3,
  });
  await view.previousButton.click();
  await view.previousButton.click();
  await expectShown(view, {
    image: imageAt(seed.hidden, 0),
    index: 0,
    total: 3,
  });
  expect(writes.requests).toEqual([]);

  const direct = await page.request.get(
    `/aufgaben/attachments/${seed.hiddenAttachmentId}`,
  );
  const allowed = await page.request.get(imageAt(seed.hidden, 0).path);

  expect(direct.status()).toBe(404);
  expect(allowed.status()).toBe(200);
  expect(allowed.headers()["content-type"]).toBe("image/png");
});
