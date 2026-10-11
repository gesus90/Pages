import { expect, it } from "vitest";

import {
  isAgentCommentOperation,
  readAgentWikiCommentsRead,
  readAgentWikiCommentWrite,
} from "@/backend/service/agents/AgentWikiCommentValidation";
import { PAGES_AGENT_COMMENT_OPERATIONS } from "@/definition/PagesAgentOperations";

const add = { operationId: "operation", pageId: "page", body: " Body " };
const target = { operationId: "operation", commentId: "comment" };

it.each(PAGES_AGENT_COMMENT_OPERATIONS)("recognizes %s", (operation) => {
  expect(isAgentCommentOperation(operation)).toBe(true);
});

it.each([null, undefined, 1, {}, "wiki.page.read", "wiki.comment.unknown"])(
  "rejects an unknown operation %j",
  (operation) => expect(isAgentCommentOperation(operation)).toBe(false),
);

it.each([
  {},
  { parentId: undefined, quote: undefined },
  { parentId: null, quote: null },
  { parentId: " parent ", quote: " Original " },
  { quote: `  ${"😀".repeat(500)}  ` },
])("reads optional add parameters without normalizing text %j", (optional) => {
  const input = { ...add, pageId: "/prefix/wiki/page/#top", ...optional };
  const before = structuredClone(input);
  expect(readAgentWikiCommentWrite("wiki.comment.add", input)).toEqual({
    ...add,
    operation: "wiki.comment.add",
    parentId: optional.parentId ?? null,
    quote: optional.quote ?? null,
  });
  expect(input).toEqual(before);
});

it.each([
  ["wiki.comment.edit", { ...target, body: " Body " }],
  ["wiki.comment.resolve", { ...target, resolved: true }],
  ["wiki.comment.resolve", { ...target, resolved: false }],
  ["wiki.comment.delete", target],
] as const)("reads the exact required parameters of %s", (operation, input) => {
  expect(readAgentWikiCommentWrite(operation, input)).toEqual({
    operation,
    ...input,
  });
  for (const key of Object.keys(input)) {
    const missing: Record<string, unknown> = { ...input };
    delete missing[key];
    expect(() => readAgentWikiCommentWrite(operation, missing)).toThrow(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  }
  expect(() =>
    readAgentWikiCommentWrite(operation, { ...input, authorId: "forged" }),
  ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
});

it.each([
  null,
  undefined,
  [],
  1,
  "input",
  {},
  { pageId: "page", body: "Body" },
  { operationId: "operation", body: "Body" },
  { operationId: "operation", pageId: "page" },
  { ...add, body: null },
  { ...add, body: 1 },
  { ...add, pageId: "/tasks/one" },
  { ...add, parentId: "" },
  { ...add, parentId: 1 },
  { ...add, parentId: "x".repeat(201) },
  { ...add, operationId: " " },
  { ...add, operationId: 1 },
  { ...add, quote: 1 },
  { ...add, quote: "😀".repeat(501) },
  { ...add, authorId: "injected" },
])("rejects malformed add input %j", (input) => {
  expect(() => readAgentWikiCommentWrite("wiki.comment.add", input)).toThrow(
    expect.objectContaining({ code: "INVALID_REQUEST" }),
  );
});

it.each([undefined, null, 1, "true", {}])(
  "requires a boolean resolved state %j",
  (resolved) => {
    expect(() =>
      readAgentWikiCommentWrite("wiki.comment.resolve", {
        ...target,
        resolved,
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
  },
);

it("reads the page ID from an address and rejects missing or additional read fields", () => {
  expect(readAgentWikiCommentsRead({ pageId: "page" })).toBe("page");
  expect(
    readAgentWikiCommentsRead({ pageId: "https://pages.invalid/wiki/page" }),
  ).toBe("page");
  for (const input of [
    null,
    {},
    { pageId: "page", extra: true },
    { pageId: 1 },
  ])
    expect(() => readAgentWikiCommentsRead(input)).toThrow(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
});
