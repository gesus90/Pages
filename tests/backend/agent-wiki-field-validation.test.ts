import { expect, it } from "vitest";

import {
  isAgentWikiFieldOperation,
  isAgentWikiPageOperation,
  readAgentWikiCoverChange,
  readAgentWikiFieldChange,
  readAgentWikiMove,
  readAgentWikiPageRequest,
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

it.each([
  undefined,
  null,
  1,
  {},
  "wiki.page.move",
  "wiki.page.setCover",
  "wiki.page.create",
])("does not classify %j as a field operation", (operation) =>
  expect(isAgentWikiFieldOperation(operation)).toBe(false),
);

it.each([
  "wiki.page.setTitle",
  "wiki.page.setContent",
  "wiki.page.setIcon",
  "wiki.page.setCover",
  "wiki.page.move",
])("classifies %s as a page operation", (operation) =>
  expect(isAgentWikiPageOperation(operation)).toBe(true),
);

it.each([undefined, null, 1, {}, "wiki.page.create", "wiki.page.delete"])(
  "does not classify %j as a page operation",
  (operation) => expect(isAgentWikiPageOperation(operation)).toBe(false),
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

const coverTarget = { operationId: "cover", pageId: "page-1" };

it.each([
  ["a preset", { kind: "preset", preset: "sunrise" }],
  ["another preset", { kind: "preset", preset: "sand" }],
  ["an attachment", { kind: "attachment", attachmentId: "attachment-1" }],
  ["no cover", null],
] as const)("reads %s as the cover of a page", (_label, cover) => {
  expect(readAgentWikiCoverChange({ ...coverTarget, cover })).toEqual({
    ...coverTarget,
    cover,
  });
  expect(
    readAgentWikiPageRequest("wiki.page.setCover", { ...coverTarget, cover }),
  ).toEqual({
    ...coverTarget,
    cover,
  });
});

it("normalizes the order of cover keys and resolves a Pages address", () => {
  expect(
    readAgentWikiCoverChange({
      cover: { preset: "forest", kind: "preset" },
      pageId: "https://pages.invalid/prefix/wiki/page-1/#top",
      operationId: "cover",
    }),
  ).toEqual({
    ...coverTarget,
    cover: { kind: "preset", preset: "forest" },
  });
});

it.each([
  { operationId: undefined },
  { operationId: "" },
  { pageId: undefined },
  { pageId: "/tasks/PAGE-1" },
  { cover: undefined },
  { cover: "preset:ocean" },
  { cover: "" },
  { cover: [] },
  { cover: 1 },
  { cover: {} },
  { cover: { kind: "gradient", preset: "ocean" } },
  { cover: { kind: "preset" } },
  { cover: { kind: "preset", preset: "aurora" } },
  { cover: { kind: "preset", preset: "Ocean" } },
  { cover: { kind: "preset", preset: null } },
  { cover: { kind: "preset", preset: "ocean", attachmentId: "a" } },
  { cover: { kind: "attachment" } },
  { cover: { kind: "attachment", attachmentId: "" } },
  { cover: { kind: "attachment", attachmentId: 1 } },
  { cover: { kind: "attachment", attachmentId: "x".repeat(201) } },
  { cover: { kind: "attachment", attachmentId: "a", preset: "ocean" } },
  { expectedRevision: 1 },
  { actor: { isAdmin: true } },
])("rejects missing, invalid or injected cover parameters %j", (overrides) => {
  expect(() =>
    readAgentWikiCoverChange({
      ...coverTarget,
      cover: { kind: "preset", preset: "ocean" },
      ...overrides,
    }),
  ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
});

it.each([null, undefined, [], 1, "request"])(
  "rejects the malformed cover envelope %j",
  (input) =>
    expect(() => readAgentWikiCoverChange(input)).toThrow(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    ),
);

it("routes a request to the reader of its operation", () => {
  expect(
    readAgentWikiPageRequest("wiki.page.setTitle", { ...target, title: "T" }),
  ).toEqual({ ...target, field: "title", value: "T" });
  expect(readAgentWikiPageRequest("wiki.page.move", move)).toEqual(move);
});
