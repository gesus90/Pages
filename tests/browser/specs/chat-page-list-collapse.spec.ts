import { expect, test } from "../support/fixtures";

import type { Page } from "@playwright/test";

/** The viewports the ticket names for the page that never scrolls. */
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
] as const;

/** Proves that the document itself does not scroll, not even by a pixel. */
async function expectFixedDocument(page: Page): Promise<void> {
  const size = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return { scroll: root.scrollHeight, client: root.clientHeight };
  });
  expect(size.scroll).toBe(size.client);
}

/** Shows a notice above the page like the offline notice of the frame does. */
async function showNotice(page: Page): Promise<void> {
  await page.evaluate(() => {
    const notice = document.createElement("p");
    notice.setAttribute("role", "status");
    notice.dataset.testNotice = "";
    notice.className =
      "mb-4 rounded-xl bg-warning-subtle px-4 py-2.5 text-sm text-warning";
    notice.textContent = "Offline";
    document.querySelector("main")?.prepend(notice);
  });
}

async function hideNotice(page: Page): Promise<void> {
  await page.evaluate(() =>
    document.querySelector("[data-test-notice]")?.remove(),
  );
}

/**
 * PAGE-325: the list of the chat page collapses to a bar of 72 px by its
 * toggle and by Ctrl+Shift+L, keeps that state after a reload, and the page
 * never scrolls the document from 768 px on.
 */
test("the chat list collapses, stays collapsed after a reload and the page never scrolls", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto("/chat");
  const list = page.getByRole("complementary", {
    name: "Groups and participants",
  });
  const collapse = page.getByRole("button", { name: "Collapse list" });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  const expandedWidth = (await list.boundingBox())?.width ?? 0;
  expect(Math.round(expandedWidth)).toBe(340);

  await collapse.click();
  const expand = page.getByRole("button", { name: "Expand list" });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(expand).toBeFocused();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect
    .poll(async () => Math.round((await list.boundingBox())?.width ?? 0))
    .toBe(72);

  await page.reload();
  await expect(page.getByRole("button", { name: "Expand list" })).toBeVisible();

  await page.keyboard.press("Control+Shift+L");
  await expect(
    page.getByRole("button", { name: "Collapse list" }),
  ).toBeVisible();
  await page.keyboard.press("Control+Shift+L");
  await expect(page.getByRole("button", { name: "Expand list" })).toBeVisible();

  await page
    .getByRole("button", { name: "Search groups and participants" })
    .click();
  await expect(page.getByRole("searchbox")).toBeFocused();
});

for (const viewport of VIEWPORTS)
  test(`the chat page does not scroll at ${viewport.width}×${viewport.height}, with and without notice, expanded and collapsed`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/chat");
    const toggle = page.getByRole("button", {
      name: /^(Collapse|Expand) list$/u,
    });
    await expect(toggle).toBeVisible();

    for (const isCollapsed of [false, true]) {
      const isNowCollapsed =
        (await toggle.getAttribute("aria-expanded")) === "false";
      if (isNowCollapsed !== isCollapsed) await toggle.click();
      await expect(toggle).toHaveAttribute(
        "aria-expanded",
        isCollapsed ? "false" : "true",
      );
      await expectFixedDocument(page);
      await showNotice(page);
      await expectFixedDocument(page);
      await hideNotice(page);
    }

    // Leave the list expanded for the next test of the same account.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
