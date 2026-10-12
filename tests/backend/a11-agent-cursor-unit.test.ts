import { createHash } from "node:crypto";

import { expect, it } from "vitest";

import { pageAgentEntries } from "@/backend/service/agents/AgentCursor";

const context = "account:query";
const contextDigest = createHash("sha256").update(context).digest("hex");

function encodeCursor(content: unknown): string {
  return Buffer.from(JSON.stringify(content)).toString("base64url");
}

it("sorts by identifier without mutating input and continues until the visible list ends", () => {
  const entries = [{ id: "c" }, { id: "a" }, { id: "b" }];
  const first = pageAgentEntries(entries, { context, limit: 1 });
  expect(first).toMatchObject({ entries: [{ id: "a" }], total: 3 });
  expect(first.nextCursor).toEqual(expect.any(String));
  const second = pageAgentEntries(entries, {
    context,
    limit: 1,
    cursor: first.nextCursor,
  });
  expect(second.entries).toEqual([{ id: "b" }]);
  expect(
    pageAgentEntries(entries, { context, cursor: second.nextCursor }),
  ).toEqual({
    entries: [{ id: "c" }],
    total: 3,
    nextCursor: null,
  });
  expect(entries).toEqual([{ id: "c" }, { id: "a" }, { id: "b" }]);
});

it("defaults to one hundred entries and supports empty, exhausted and null-cursor reads", () => {
  const entries = Array.from({ length: 101 }, (_, index) => ({
    id: String(index).padStart(3, "0"),
  }));
  expect(pageAgentEntries(entries, { context }).entries).toHaveLength(100);
  expect(pageAgentEntries([], { context, cursor: null })).toEqual({
    entries: [],
    total: 0,
    nextCursor: null,
  });
  expect(
    pageAgentEntries(entries, {
      context,
      cursor: encodeCursor({
        version: 1,
        context: contextDigest,
        after: "999",
      }),
    }),
  ).toEqual({ entries: [], total: 101, nextCursor: null });
});

it("preserves a trusted repository order and refuses a removed continuation anchor", () => {
  const entries = [{ id: "z" }, { id: "a" }, { id: "m" }];
  const first = pageAgentEntries(entries, {
    context,
    limit: 1,
    preserveOrder: true,
  });
  expect(first.entries).toEqual([{ id: "z" }]);
  expect(
    pageAgentEntries(entries, {
      context,
      cursor: first.nextCursor,
      preserveOrder: true,
    }),
  ).toEqual({
    entries: [{ id: "a" }, { id: "m" }],
    total: 3,
    nextCursor: null,
  });
  expect(() =>
    pageAgentEntries(entries.slice(1), {
      context,
      cursor: first.nextCursor,
      preserveOrder: true,
    }),
  ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
});

it("cannot reuse a continuation under a different account or query", () => {
  const first = pageAgentEntries([{ id: "a" }, { id: "b" }], {
    context,
    limit: 1,
  });
  expect(() =>
    pageAgentEntries([], {
      context: "other-account:query",
      cursor: first.nextCursor,
    }),
  ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
});

it("handles equal identifiers deterministically", () => {
  expect(
    pageAgentEntries(
      [
        { id: "a", title: "first" },
        { id: "a", title: "second" },
      ],
      { context },
    ).entries,
  ).toEqual([
    { id: "a", title: "first" },
    { id: "a", title: "second" },
  ]);
});

it.each([null, "1", 0, -1, 101, 1.5, NaN, Infinity])(
  "rejects an invalid page limit %j",
  (limit) => {
    expect(() => pageAgentEntries([], { context, limit })).toThrow(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  },
);

it.each([
  123,
  "a".repeat(2049),
  Buffer.from("not JSON").toString("base64url"),
  ...[
    null,
    1,
    [],
    {},
    { version: 2 },
    { version: 1 },
    { version: 1, context: "wrong", after: "a" },
    { version: 1, context: contextDigest },
    { version: 1, context: contextDigest, after: 1 },
  ].map(encodeCursor),
])("rejects malformed or unbound cursors %j", (cursor) => {
  expect(() => pageAgentEntries([], { context, cursor })).toThrow(
    expect.objectContaining({ code: "INVALID_REQUEST" }),
  );
});
