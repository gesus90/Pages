import { expect, it } from "vitest";

import {
  extractWikiLinks,
  mentionsWikiPage,
  resolveWikiPageReference,
} from "./WikiLinks";

it("extracts page and ticket links once and skips reserved paths", () => {
  expect(
    extractWikiLinks(
      "/wiki/a /wiki/a /wiki/trash [x](page:b) [y](page:search) /tasks/ab-1 /aufgaben/AB-1 /wiki/search",
    ),
  ).toEqual({ pageIds: ["a", "b"], ticketKeys: ["AB-1"] });
});

it("resolves identifiers and addresses to a page identifier", () => {
  expect(resolveWikiPageReference(" abc-1 ")).toBe("abc-1");
  expect(resolveWikiPageReference("https://host/pre/wiki/abc/?x=1")).toBe(
    "abc",
  );
  expect(resolveWikiPageReference("/wiki/abc")).toBe("abc");
  expect(resolveWikiPageReference("trash")).toBeNull();
  expect(resolveWikiPageReference("some text")).toBeNull();
});

it("tells whether a text mentions a page", () => {
  expect(mentionsWikiPage("see /wiki/p1", "p1")).toBe(true);
  expect(mentionsWikiPage("see /wiki/p1", "p2")).toBe(false);
});
