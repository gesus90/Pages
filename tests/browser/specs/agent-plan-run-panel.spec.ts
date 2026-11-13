import { expect, test } from "../support/fixtures";

/**
 * PAGE-338: collapsed, the run panel of a plan shows its heading and the
 * status marker only, and the marker opens and closes the panel from the
 * keyboard while the focus stays on it.
 */
test("the status marker opens and closes the run panel with Enter and Space and keeps the focus", async ({
  page,
  seed,
}) => {
  await page.goto(`/agents/plans?planId=${encodeURIComponent(seed.plan.id)}`);

  const panel = page.locator("[data-plan-panel]");
  const marker = panel.locator("[data-plan-panel-status]");

  await expect(marker).toHaveAttribute("aria-expanded", "false");
  // Collapsed, the marker is the only status line; no hint stands beside it.
  await expect(panel.getByRole("status")).toHaveCount(1);
  await expect(panel.getByText("Plan saved")).toHaveCount(0);

  await marker.focus();
  await page.keyboard.press("Enter");

  await expect(marker).toHaveAttribute("aria-expanded", "true");
  await expect(marker).toBeFocused();
  await expect(panel.getByText("Plan saved")).toBeVisible();

  await page.keyboard.press("Space");

  await expect(marker).toHaveAttribute("aria-expanded", "false");
  await expect(marker).toBeFocused();
  await expect(panel.getByText("Plan saved")).toHaveCount(0);

  await page.keyboard.press("Space");

  await expect(marker).toHaveAttribute("aria-expanded", "true");
  await expect(marker).toBeFocused();

  await page.keyboard.press("Enter");

  await expect(marker).toHaveAttribute("aria-expanded", "false");
  await expect(marker).toBeFocused();
});
