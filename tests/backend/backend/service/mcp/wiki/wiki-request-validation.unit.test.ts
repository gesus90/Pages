import { expect, it } from "vitest";

import { McpWikiRequest } from "@/backend/service/mcp/wiki/McpWikiRequest";

it("requires a changed field and a nonnegative revision", () => {
  expect(() => McpWikiRequest.update({ expectedRevision: 1 })).toThrow();
  expect(() =>
    McpWikiRequest.update({ expectedRevision: -1, title: "Title" }),
  ).toThrow();
  expect(
    McpWikiRequest.update({ expectedRevision: 1, title: "Title" }),
  ).toMatchObject({ expectedRevision: 1, title: "Title" });
  expect(() => McpWikiRequest.properties({})).toThrow();
});

it("rejects duplicate query parameters and interprets backlink selection", () => {
  expect(() =>
    McpWikiRequest.tree(new URLSearchParams("scope=project&scope=global")),
  ).toThrow();
  expect(McpWikiRequest.read(new URLSearchParams("backlinks=1"))).toEqual({
    withBacklinks: true,
  });
  expect(McpWikiRequest.read(new URLSearchParams())).toEqual({
    withBacklinks: false,
  });
  expect(() =>
    McpWikiRequest.read(new URLSearchParams("backlinks=yes")),
  ).toThrow();
});
