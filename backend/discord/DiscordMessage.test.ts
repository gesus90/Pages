import { expect, it, vi } from "vitest";

import {
  buildNotificationMessage,
  buildTestMessage,
  neutralizeUntrustedText,
  parseNotificationContent,
} from "./DiscordMessage";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

it("neutralizes mentions, controls, formatting and long text", () => {
  expect(
    neutralizeUntrustedText(" @everyone\n<#channel> https://x *bold*\u202E "),
  ).toBe("@\u200Beveryone <\u200B#channel\\> https:\u200B//x \\*bold\\*");
  expect(neutralizeUntrustedText("x".repeat(161))).toBe(`${"x".repeat(159)}…`);
});

it("builds notification and connection messages with mentions disabled", () => {
  const content = {
    event: "ticket.created" as const,
    projectName: "Project",
    reference: "KEY-1",
    title: "Title",
    status: "Open",
    url: "https://example.com",
  };
  expect(buildNotificationMessage(content)).toEqual({
    allowed_mentions: { parse: [] },
    flags: 4,
    content:
      "**Ticket created** · KEY-1\n\u200BTitle\nProject: Project · Status: Open\nhttps://example.com",
  });
  expect(
    buildNotificationMessage({
      ...content,
      event: "milestone.updated",
      reference: null,
      status: null,
    }).content,
  ).toContain("**Milestone updated**\n\u200BTitle\nProject: Project\n");
  expect(buildTestMessage("@all", "url").content).toContain("@\u200Ball");
});

it("validates stored notification facts and tolerates absent optional values", () => {
  expect(parseNotificationContent("{")).toBeNull();
  expect(parseNotificationContent("null")).toBeNull();
  expect(parseNotificationContent("3")).toBeNull();
  const content = {
    event: "ticket.created",
    projectName: "P",
    title: "T",
    url: "U",
    reference: 1,
    status: "Open",
  };
  expect(parseNotificationContent(JSON.stringify(content))).toEqual({
    ...content,
    reference: null,
  });
  for (const invalid of [
    { ...content, event: "bad" },
    { ...content, projectName: null },
    { ...content, title: null },
    { ...content, url: null },
  ]) {
    expect(parseNotificationContent(JSON.stringify(invalid))).toBeNull();
  }
});
