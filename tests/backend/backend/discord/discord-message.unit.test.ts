import { expect, it } from "vitest";

import {
  buildNotificationMessage,
  buildTestMessage,
  neutralizeUntrustedText,
  parseNotificationContent,
} from "@/backend/discord/DiscordMessage";

import type { DiscordNotificationContent } from "@/backend/discord/DiscordMessage";

const CONTENT: DiscordNotificationContent = {
  event: "ticket.updated",
  projectName: "Alpha",
  reference: "PAGE-7",
  status: "To Do",
  title: "Write the notification",
  url: "https://pages.example.test/tasks/PAGE-7",
};

it("builds a short message with event, item, project, status and link", () => {
  const message = buildNotificationMessage(CONTENT);

  expect(message.content.split("\n")).toEqual([
    "**Ticket updated** · PAGE-7",
    "\u200BWrite the notification",
    "Project: Alpha · Status: To Do",
    "https://pages.example.test/tasks/PAGE-7",
  ]);
});

it("disables every kind of mention on every message", () => {
  const notification = buildNotificationMessage(CONTENT);
  const test = buildTestMessage(
    "Alpha",
    "https://pages.example.test/projekte/a",
  );

  expect(notification.allowed_mentions).toEqual({ parse: [] });
  expect(test.allowed_mentions).toEqual({ parse: [] });
  expect(notification.flags).toBe(4);
});

it("omits the reference and the status of a milestone when they do not exist", () => {
  const message = buildNotificationMessage({
    ...CONTENT,
    event: "milestone.created",
    reference: null,
    status: null,
  });

  expect(message.content.split("\n")).toEqual([
    "**Milestone created**",
    "\u200BWrite the notification",
    "Project: Alpha",
    "https://pages.example.test/tasks/PAGE-7",
  ]);
});

it("breaks every form of a mention", () => {
  const text = neutralizeUntrustedText(
    "@everyone @here <@123> <@!123> <@&456> <#789>",
  );

  expect(text).not.toMatch(/@everyone|@here/);
  expect(text).not.toMatch(/<@[!&]?\d/);
  expect(text).not.toContain("<#789>");
});

it("escapes markdown, links and masked links", () => {
  const text = neutralizeUntrustedText(
    "**bold** _it_ ~~x~~ ||spoiler|| `code` > quote [label](https://evil.example) https://evil.example",
  );

  expect(text).not.toContain("](https://");
  expect(text).not.toMatch(/(^|[^\\])\*\*/);
  expect(text).not.toContain("https://evil.example");
});

it("keeps a title on one line and shortens it", () => {
  expect(neutralizeUntrustedText("one\ntwo\r\n\tthree")).toBe("one two three");

  const shortened = neutralizeUntrustedText("x".repeat(500));

  expect(shortened.length).toBeLessThanOrEqual(160);
  expect(shortened.endsWith("…")).toBe(true);
});

it("removes invisible and direction-changing characters", () => {
  expect(neutralizeUntrustedText("a\u200Bb\u202Ec\u2066d")).toBe("abcd");
});

it("reads stored content back and refuses anything else", () => {
  expect(parseNotificationContent(JSON.stringify(CONTENT))).toEqual(CONTENT);
  expect(
    parseNotificationContent(
      JSON.stringify({ ...CONTENT, reference: null, status: null }),
    ),
  ).toMatchObject({ reference: null, status: null });

  for (const broken of [
    "not json",
    "null",
    "[]",
    JSON.stringify({ ...CONTENT, event: "wiki.page.created" }),
    JSON.stringify({ ...CONTENT, title: 5 }),
    JSON.stringify({ projectName: "Alpha" }),
  ]) {
    expect(parseNotificationContent(broken)).toBeNull();
  }
});
