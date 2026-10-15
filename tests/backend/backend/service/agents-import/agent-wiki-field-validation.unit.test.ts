import { describe, expect, it } from "vitest";

import {
  isAgentWikiFieldOperation,
  isAgentWikiPageOperation,
  normalizeRevision,
  readAgentWikiFieldChange,
  readWikiPageReference,
} from "@/backend/service/agents/AgentWikiFieldValidation";

import {
  expectInvalidRequest,
  expectTooLarge,
} from "./operation-error-expectation";

const TARGET = { operationId: "op-1", pageId: "page-1", expectedRevision: 3 };

describe("operation name guards", () => {
  it("separates field operations from the other page operations", () => {
    expect(isAgentWikiFieldOperation("wiki.page.setTitle")).toBe(true);
    expect(isAgentWikiFieldOperation("wiki.page.move")).toBe(false);
    expect(isAgentWikiFieldOperation(7)).toBe(false);
    for (const name of [
      "wiki.page.setIcon",
      "wiki.page.patchContent",
      "wiki.page.setCover",
      "wiki.page.move",
    ])
      expect(isAgentWikiPageOperation(name)).toBe(true);
    expect(isAgentWikiPageOperation("wiki.page.delete")).toBe(false);
  });
});

describe("readWikiPageReference", () => {
  it.each([
    ["page-1", "page-1"],
    ["  page_2 ", "page_2"],
    ["/wiki/abc-123", "abc-123"],
    ["/prefix/wiki/abc-123/", "abc-123"],
    ["https://pages.test/wiki/abc?x=1#y", "abc"],
  ])("resolves %j", (reference, id) => {
    expect(readWikiPageReference(reference)).toBe(id);
  });

  it.each([
    ["a title with spaces", "My Page Title"],
    ["a reserved name", "trash"],
    ["a reserved address", "/wiki/attachments"],
    ["the search address", "/wiki/search"],
    ["an empty text", ""],
    ["a number", 5],
    ["an address of another area", "/tasks/PAGE-1"],
  ])("refuses %s", (_, input) => {
    expectInvalidRequest(() => readWikiPageReference(input));
  });
});

describe("normalizeRevision", () => {
  it("renames the specified spelling", () => {
    expect(normalizeRevision({ expected_revision: 2, pageId: "p" })).toEqual({
      expectedRevision: 2,
      pageId: "p",
    });
  });

  it("returns the camel-case spelling unchanged", () => {
    const fields = { expectedRevision: 2 };
    expect(normalizeRevision(fields)).toBe(fields);
  });

  it("refuses both spellings at once", () => {
    expectInvalidRequest(() =>
      normalizeRevision({ expected_revision: 1, expectedRevision: 2 }),
    );
  });
});

describe("readAgentWikiFieldChange", () => {
  it("reads a title change", () => {
    expect(
      readAgentWikiFieldChange("wiki.page.setTitle", {
        ...TARGET,
        title: "Roadmap",
      }),
    ).toEqual({
      operationId: "op-1",
      pageId: "page-1",
      expectedRevision: 3,
      field: "title",
      value: "Roadmap",
    });
  });

  it("accepts the page by address and the revision as expected_revision", () => {
    const change = readAgentWikiFieldChange("wiki.page.setContent", {
      operationId: "op-1",
      pageId: "/wiki/page-9",
      expected_revision: 4,
      content: "# Body",
    });
    expect(change).toMatchObject({
      pageId: "page-9",
      expectedRevision: 4,
      field: "content",
    });
  });

  it("removes an icon with null and sets one with a string", () => {
    expect(
      readAgentWikiFieldChange("wiki.page.setIcon", { ...TARGET, icon: null }),
    ).toMatchObject({ field: "icon", value: null });
    expect(
      readAgentWikiFieldChange("wiki.page.setIcon", { ...TARGET, icon: "📘" }),
    ).toMatchObject({ value: "📘" });
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["text", "3"],
    ["beyond the safe integers", 2 ** 53],
    ["null", null],
  ])("refuses a revision that is %s", (_, expectedRevision) => {
    expectInvalidRequest(() =>
      readAgentWikiFieldChange("wiki.page.setTitle", {
        ...TARGET,
        expectedRevision,
        title: "x",
      }),
    );
  });

  it.each([
    ["a title that is a number", "wiki.page.setTitle", { title: 5 }],
    ["an icon that is a number", "wiki.page.setIcon", { icon: 1 }],
    ["content that is null", "wiki.page.setContent", { content: null }],
    ["a missing value", "wiki.page.setTitle", {}],
    ["an unknown parameter", "wiki.page.setTitle", { title: "x", cover: null }],
  ] as const)("refuses %s", (_, operation, fields) => {
    expectInvalidRequest(() =>
      readAgentWikiFieldChange(operation, { ...TARGET, ...fields }),
    );
  });

  it("refuses a missing operation ID or page", () => {
    expectInvalidRequest(() =>
      readAgentWikiFieldChange("wiki.page.setTitle", {
        pageId: "p",
        expectedRevision: 1,
        title: "x",
      }),
    );
    expectInvalidRequest(() =>
      readAgentWikiFieldChange("wiki.page.setTitle", {
        ...TARGET,
        pageId: "Some Title",
        title: "x",
      }),
    );
  });
});

describe("wiki content size limit", () => {
  const LIMIT = 1_048_576;
  const call = (content: string): unknown =>
    readAgentWikiFieldChange("wiki.page.setContent", { ...TARGET, content });

  it("accepts content of exactly the byte limit", () => {
    expect(call("a".repeat(LIMIT))).toMatchObject({ field: "content" });
  });

  it("refuses one byte more, naming the limit", () => {
    expectTooLarge(() => call("a".repeat(LIMIT + 1)), {
      constraint: "wikiContentBytes",
      limit: LIMIT,
    });
  });

  it("counts bytes, not characters", () => {
    // 349 526 characters of three bytes each stay below the limit as text length.
    const content = "€".repeat(349_526);
    expect(content.length).toBeLessThan(LIMIT);
    expectTooLarge(() => call(content), {
      constraint: "wikiContentBytes",
      limit: LIMIT,
    });
  });

  it("does not apply the content limit to titles", () => {
    expect(
      readAgentWikiFieldChange("wiki.page.setTitle", {
        ...TARGET,
        title: "a".repeat(LIMIT + 1),
      }),
    ).toMatchObject({ field: "title" });
  });
});
