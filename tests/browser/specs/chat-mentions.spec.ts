import { expect, test } from "../support/fixtures";
import { openMentionChat } from "../support/mention-chat";

test("group mentions offer aliases and members with keyboard insertion and atomic deletion", async ({
  page,
  writes,
}) => {
  await openMentionChat(page);
  const composer = page.getByRole("combobox", {
    name: "Message to Mention team",
  });
  await composer.fill("@");
  const list = page.getByRole("listbox");
  await expect(list).toBeVisible();
  const everyone = list.getByRole("option").filter({ hasText: "@alle" });
  await expect(everyone).toHaveAttribute("aria-selected", "true");
  await expect(everyone).toContainText("@all");
  await expect(everyone).toContainText("@team");
  const outside = list.getByRole("option").filter({ hasText: "Pica" });
  await expect(outside).toHaveAttribute("aria-disabled", "true");

  await composer.press("ArrowDown");
  await composer.press("Tab");
  const chip = composer.locator(
    "[data-chat-mention='a-team'][contenteditable='false']",
  );
  await expect(chip).toHaveText("@a-team");
  await expect(list).toBeHidden();
  await composer.press("Backspace");
  await composer.press("Backspace");
  await expect(chip).toHaveCount(0);
  await expect(composer).not.toContainText("a-tea");

  await composer.fill("@ed");
  await expect(
    list.getByRole("option").filter({ hasText: "@ed" }),
  ).toBeVisible();
  await composer.press("Enter");
  await expect(composer.locator("[data-chat-mention='ed']")).toHaveText("@ed");
  await expect(page.getByRole("log")).not.toContainText("@ed");
  expect(writes.requests).not.toContain("POST /chat.data");
});

test("group mention suggestions filter, insert by mouse and dismiss without a match", async ({
  page,
}) => {
  await openMentionChat(page);
  const composer = page.getByRole("combobox", {
    name: "Message to Mention team",
  });
  await composer.fill("Please ask @ba");
  const list = page.getByRole("listbox");
  const designer = list.getByRole("option").filter({ hasText: "Bakuman" });
  await expect(designer).toBeVisible();
  await expect(designer.locator("strong").first()).toContainText(/ba/iu);
  await designer.click();
  await expect(composer.locator("[data-chat-mention='bakuman']")).toHaveText(
    "@bakuman",
  );
  await expect(composer).toContainText("Please ask");

  await composer.fill("@nobody-matches");
  await expect(list).toContainText("@nobody-matches");
  await expect(list.getByRole("option")).toHaveCount(0);
  await composer.press("Space");
  await expect(list).toBeHidden();

  await composer.fill("@");
  await expect(list).toBeVisible();
  await composer.press("Escape");
  await expect(list).toBeHidden();
  await composer.fill("mail@example.org");
  await expect(list).toBeHidden();
});

test("messages distinguish own mentions and show decision probabilities", async ({
  page,
}) => {
  await openMentionChat(page);
  const message = page.getByRole("article", { name: "Ed", exact: true });
  const ownMention = message.locator("mark[data-chat-mention='admin']");
  await expect(ownMention).toHaveCount(1);
  await expect(ownMention).toHaveAttribute("data-own-mention", "true");
  await expect(ownMention).toHaveClass(/bg-primary\b/u);
  await expect(ownMention).toHaveClass(/text-primary-foreground/u);
  await expect(message).toHaveAttribute("data-own-mention", "true");
  await expect(message).toHaveClass(/border-primary/u);
  const otherMention = message.locator("mark[data-chat-mention='bakuman']");
  await expect(otherMention).toHaveCount(1);
  await expect(otherMention).toHaveClass(/bg-primary-subtle/u);
  await expect(otherMention).toHaveClass(/text-status-active/u);
  await expect(otherMention).not.toHaveAttribute("data-own-mention", "true");

  await page.getByText("Why?", { exact: true }).click();
  await expect(
    page.getByText("Answer expected 82 % · Ed 78 %, nobody 22 %", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Decision model: example/decision-model"),
  ).toBeVisible();
});

test("the group shows whether its decision model is active or falls back", async ({
  page,
}) => {
  await openMentionChat(page);
  await expect(
    page.locator("[role='status'][data-chat-decision-status='ready']"),
  ).toContainText("Decision model active");
  await expect(
    page.locator("[role='status'][data-chat-decision-status='ready']"),
  ).toContainText("No decision model · like “@ only”");

  await page.unroute("**/chat-page-api/page");
  await openMentionChat(page, "noModel");
  await expect(
    page.locator("[role='status'][data-chat-decision-status='noModel']"),
  ).toContainText("No decision model · @ only");

  await page.unroute("**/chat-page-api/page");
  await openMentionChat(page, "modelUnavailable");
  await expect(
    page.locator(
      "[role='status'][data-chat-decision-status='modelUnavailable']",
    ),
  ).toContainText("Decision model unavailable · @ only");
});
