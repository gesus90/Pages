import { expect, test } from "../support/fixtures";

import type { Locator, Page } from "@playwright/test";

/** Opens one entry of the plan menu of the opened plan. */
async function openPlanMenuItem(page: Page, name: string): Promise<Locator> {
  await page.getByRole("button", { name: "Plan actions" }).click();
  await page.getByRole("menuitem", { name }).click();

  return page.getByRole("dialog");
}

/**
 * PAGE-329: teams, their rights and the owner of a plan change completely in
 * the plan editor, and every change is in the history of the plan.
 */
test("an administrator gives a plan a team with chosen rights and a new owner", async ({
  page,
  seed,
}) => {
  await page.goto(`/agents/plans?planId=${encodeURIComponent(seed.plan.id)}`);
  await expect(page.locator("[data-plan-admin-access]")).toHaveCount(0);

  const dialog = await openPlanMenuItem(page, "Teams and owner");

  await expect(dialog.locator("[data-plan-teams-empty]")).toBeVisible();
  await dialog
    .getByRole("textbox", { name: "Search group or department" })
    .fill(seed.plan.teamName.slice(0, 3));
  await dialog
    .locator(`[data-plan-team-choice="${seed.plan.teamName}"]`)
    .click();

  const row = dialog.locator(`[data-plan-team="${seed.plan.teamName}"]`);

  // A new team has all three rights; the administrator takes away "run".
  for (const right of ["canRead", "canEdit", "canRun"]) {
    await expect(
      row.locator(`[data-plan-team-right="${right}"]`),
    ).toBeChecked();
  }
  await row.locator('[data-plan-team-right="canRun"]').uncheck();

  await dialog.getByRole("combobox", { name: "Owner" }).click();
  await page.getByRole("option", { name: "Rita Reader" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  // The plan is somebody else's now: the administrator works with admin access.
  await expect(page.locator("[data-plan-admin-access]")).toHaveText(
    "Admin access",
  );

  const reopened = await openPlanMenuItem(page, "Teams and owner");
  const saved = reopened.locator(`[data-plan-team="${seed.plan.teamName}"]`);

  await expect(saved.locator('[data-plan-team-right="canRead"]')).toBeChecked();
  await expect(saved.locator('[data-plan-team-right="canEdit"]')).toBeChecked();
  await expect(
    saved.locator('[data-plan-team-right="canRun"]'),
  ).not.toBeChecked();
  await expect(reopened.getByRole("combobox", { name: "Owner" })).toHaveText(
    /Rita Reader/u,
  );
  await page.keyboard.press("Escape");
  await expect(reopened).toBeHidden();

  const history = await openPlanMenuItem(page, "History");

  await expect(
    history.locator('[data-plan-history-action="teams_changed"]'),
  ).toHaveCount(1);
  await expect(
    history.locator('[data-plan-history-action="owner_changed"]'),
  ).toHaveCount(1);
  await expect(history.locator("[data-plan-history]")).toContainText(
    "changed the owner",
  );
});
