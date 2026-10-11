import { expect, it } from "vitest";

import {
  isAgentWikiFieldOperation,
  readAgentWikiFieldChange,
  readAgentWikiMove,
  readWikiPageReference,
} from "@/backend/service/agents/AgentWikiFieldValidation";
import { resolveWikiPageReference } from "@/backend/service/wiki/WikiLinks";

const target = { operationId: "change", pageId: "page-1", expectedRevision: 1 };
const move = { ...target, projectId: "alpha", parentId: null, beforeId: null };

it.each([
  ["wiki.page.setTitle", "title", "Title"],
  ["wiki.page.setContent", "content", "\uFEFF# Text\r\n"],
  ["wiki.page.setIcon", "icon", "📘"],
  ["wiki.page.setIcon", "icon", null],
] as const)(
  "reads only the field named by %s with %j",
  (operation, field, value) => {
    expect(isAgentWikiFieldOperation(operation)).toBe(true);
    expect(
      readAgentWikiFieldChange(operation, { ...target, [field]: value }),
    ).toEqual({
      ...target,
      field,
      value,
    });
  },
);

it.each([undefined, null, 1, {}, "wiki.page.move", "wiki.page.create"])(
  "does not classify %j as a field operation",
  (operation) => expect(isAgentWikiFieldOperation(operation)).toBe(false),
);

it.each([null, undefined, [], 1, "request"])(
  "rejects malformed envelopes %j",
  (input) => {
    expect(() => readAgentWikiFieldChange("wiki.page.setTitle", input)).toThrow(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
    expect(() => readAgentWikiMove(input)).toThrow(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  },
);

it.each([
  { operationId: undefined },
  { operationId: "" },
  { operationId: "x".repeat(201) },
  { pageId: undefined },
  { pageId: "/tasks/PAGE-1" },
  { pageId: "/wiki/trash" },
  { expectedRevision: undefined },
  { expectedRevision: "1" },
  { expectedRevision: 1.5 },
  { expectedRevision: Number.NaN },
  { expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
  { expectedRevision: 0 },
  { expectedRevision: -1 },
  { title: undefined },
  { title: null },
  { title: 1 },
  { content: "injected" },
  { actor: { isAdmin: true } },
])("rejects missing, invalid or injected title parameters %j", (overrides) => {
  expect(() =>
    readAgentWikiFieldChange("wiki.page.setTitle", {
      ...target,
      title: "Title",
      ...overrides,
    }),
  ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
});

it.each([undefined, 1, false, {}])("rejects a malformed icon %j", (icon) => {
  expect(() =>
    readAgentWikiFieldChange("wiki.page.setIcon", { ...target, icon }),
  ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
});

it("requires every key and resolves page, parent and sibling addresses without mutating input", () => {
  const input = {
    ...move,
    pageId: " https://pages.invalid/prefix/wiki/page-1/?q=x#top ",
    parentId: "/wiki/parent",
    beforeId: "/wiki/sibling#top",
  };
  expect(readAgentWikiMove(input)).toEqual({
    ...move,
    parentId: "parent",
    beforeId: "sibling",
  });
  expect(input.pageId).toContain("https://");
  expect(readAgentWikiMove(move)).toEqual(move);
  for (const key of Object.keys(move)) {
    const missing: Record<string, unknown> = { ...move };
    delete missing[key];
    expect(() => readAgentWikiMove(missing)).toThrow(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  }
});

it.each([
  { projectId: null },
  { parentId: undefined },
  { beforeId: 1 },
  { extra: true },
])("rejects malformed move parameters %j", (overrides) =>
  expect(() => readAgentWikiMove({ ...move, ...overrides })).toThrow(
    expect.objectContaining({ code: "INVALID_REQUEST" }),
  ),
);
it.each([
  " page-1 ",
  "/wiki/page-1",
  "/prefix/wiki/page-1/",
  "https://pages.invalid/prefix/wiki/page-1?q=x#top",
  "http://pages.invalid/wiki/page-1/#top",
])("resolves %s by its path", (reference) => {
  expect(resolveWikiPageReference(reference)).toBe("page-1");
  expect(readWikiPageReference(reference)).toBe("page-1");
});

it.each([
  "",
  "Page title",
  "attachments",
  "/wiki/trash",
  "/wiki/search",
  "/wiki/page-1/child",
  "/tasks/PAGE-1",
  "ftp://pages.invalid/wiki/page-1",
  "/wiki/page-1 trailing",
])("rejects titles, reserved and foreign paths %j", (reference) => {
  expect(resolveWikiPageReference(reference)).toBeNull();
  expect(() => readWikiPageReference(reference)).toThrow(
    expect.objectContaining({ code: "INVALID_REQUEST" }),
  );
});
