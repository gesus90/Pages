import { expect, test } from "../support/fixtures";

/**
 * PAGE-335: the idle time after which a resting chat session of an agent ends
 * is a setting of the agents, and the resource view lists the chat sessions
 * the agents hold.
 */
test("an administrator sets the idle time of chat sessions and sees the held sessions", async ({
  page,
}) => {
  await page.goto("/settings/agents");
  const idle = page.getByRole("spinbutton", {
    name: "Idle time of a chat session (minutes)",
  });
  await expect(idle).toHaveValue("10");
  await idle.fill("25");
  const form = page.locator("form", { has: idle });
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByRole("status")).toHaveText("Limits saved.");

  await page.reload();
  await expect(
    page.getByRole("spinbutton", {
      name: "Idle time of a chat session (minutes)",
    }),
  ).toHaveValue("25");

  await page.goto("/settings/system");
  await expect(
    page.getByRole("heading", { name: "Chat sessions of the agents" }),
  ).toBeVisible();
  await expect(
    page.getByText("No agent holds a chat session open right now."),
  ).toBeVisible();
});
