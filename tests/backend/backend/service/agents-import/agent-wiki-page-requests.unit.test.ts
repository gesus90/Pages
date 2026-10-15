import { describe, expect, it } from "vitest";

import {
  readAgentWikiContentPatch,
  readAgentWikiCoverChange,
  readAgentWikiMove,
  readAgentWikiPageRange,
  readAgentWikiPageRequest,
} from "@/backend/service/agents/AgentWikiFieldValidation";

import {
  expectInvalidRequest,
  expectTooLarge,
} from "./operation-error-expectation";

describe("readAgentWikiCoverChange", () => {
  const base = { operationId: "op-1", pageId: "page-1" };

  it.each([
    [{ kind: "preset", preset: "ocean" }],
    [{ kind: "attachment", attachmentId: "attachment-1" }],
    [null],
  ])("accepts the cover %j", (cover) => {
    expect(readAgentWikiCoverChange({ ...base, cover })).toEqual({
      ...base,
      cover,
    });
  });

  it.each([
    ["an unknown preset", { kind: "preset", preset: "neon" }],
    ["an unknown kind", { kind: "color", color: "#fff" }],
    [
      "a preset with an attachment ID",
      { kind: "preset", preset: "ocean", attachmentId: "a" },
    ],
    ["an attachment without an ID", { kind: "attachment" }],
    ["an attachment with a blank ID", { kind: "attachment", attachmentId: "" }],
    ["a string", "ocean"],
  ])("refuses %s", (_, cover) => {
    expectInvalidRequest(() => readAgentWikiCoverChange({ ...base, cover }));
  });

  it("requires the cover parameter and takes no revision", () => {
    expectInvalidRequest(() => readAgentWikiCoverChange(base));
    expectInvalidRequest(() =>
      readAgentWikiCoverChange({ ...base, cover: null, expectedRevision: 1 }),
    );
  });
});

describe("readAgentWikiPageRange", () => {
  it("resolves the page and defaults the budget", () => {
    expect(
      readAgentWikiPageRange({ pageId: "/wiki/page-1", start: { line: 2 } }),
    ).toEqual({
      pageId: "page-1",
      range: {
        start: { line: 2, column: 1 },
        end: null,
        maxCharacters: 4_096,
      },
    });
  });

  it("refuses a budget over the limit as too large", () => {
    expectTooLarge(
      () =>
        readAgentWikiPageRange({
          pageId: "page-1",
          start: { line: 1 },
          maxCharacters: 20_000,
        }),
      { constraint: "textRangeCharacters", limit: 16_384 },
    );
  });

  it("refuses a page named by its title", () => {
    expectInvalidRequest(() =>
      readAgentWikiPageRange({ pageId: "Release notes", start: { line: 1 } }),
    );
  });
});

describe("readAgentWikiContentPatch", () => {
  const patch = {
    operationId: "op-1",
    pageId: "page-1",
    expectedRevision: 2,
    start: { line: 1, column: 1 },
    end: { line: 1, column: 4 },
    expectedText: "Old",
    replacementText: "New",
  };

  it("reads the range with the revision it was read at", () => {
    expect(readAgentWikiContentPatch(patch)).toEqual({
      operationId: "op-1",
      pageId: "page-1",
      expectedRevision: 2,
      start: { line: 1, column: 1 },
      end: { line: 1, column: 4 },
      expectedText: "Old",
      replacementText: "New",
      includeAfter: false,
    });
  });

  it("accepts expected_revision and includeAfter", () => {
    const { expectedRevision, ...rest } = patch;
    const result = readAgentWikiContentPatch({
      ...rest,
      expected_revision: expectedRevision,
      includeAfter: true,
    });
    expect(result).toMatchObject({ expectedRevision: 2, includeAfter: true });
  });

  it.each([
    ["no revision", { expectedRevision: undefined }],
    ["a start without a column", { start: { line: 1 } }],
    ["the whole content as an extra field", { content: "all" }],
  ])("refuses a patch with %s", (_, change) => {
    const fields = Object.fromEntries(
      Object.entries({ ...patch, ...change }).filter(
        ([key, value]) => !(key in change && value === undefined),
      ),
    );
    expectInvalidRequest(() => readAgentWikiContentPatch(fields));
  });
});

describe("readAgentWikiMove", () => {
  const move = {
    operationId: "op-1",
    pageId: "page-1",
    expectedRevision: 5,
    projectId: "project-1",
    parentId: null,
    beforeId: null,
  };

  it("reads a move to the end of a project root", () => {
    expect(readAgentWikiMove(move)).toEqual(move);
  });

  it("resolves parent and sibling given as addresses", () => {
    const result = readAgentWikiMove({
      ...move,
      parentId: "/wiki/parent-1",
      beforeId: "https://pages.test/wiki/sibling-1",
    });
    expect(result).toMatchObject({
      parentId: "parent-1",
      beforeId: "sibling-1",
    });
  });

  it.each(["instance", "private"] as const)(
    "moves into the %s scope without a project",
    (scope) => {
      const result = readAgentWikiMove({ ...move, projectId: null, scope });
      expect(result).toMatchObject({ projectId: null, scope });
    },
  );

  it("leaves the scope out when none was given", () => {
    expect(readAgentWikiMove(move)).not.toHaveProperty("scope");
  });

  it.each([
    ["no project and no scope", { projectId: null }],
    ["no project and the project scope", { projectId: null, scope: "project" }],
    ["an unknown scope", { scope: "team" }],
    ["a missing parent", { parentId: undefined }],
    ["a missing sibling", { beforeId: undefined }],
    ["a parent named by title", { parentId: "Some Title" }],
    ["an unknown parameter", { copy: true }],
  ])("refuses a move with %s", (_, change) => {
    const fields = Object.fromEntries(
      Object.entries({ ...move, ...change }).filter(
        ([key, value]) => !(key in change && value === undefined),
      ),
    );
    expectInvalidRequest(() => readAgentWikiMove(fields));
  });
});

describe("readAgentWikiPageRequest", () => {
  const target = { operationId: "op-1", pageId: "page-1" };

  it("dispatches each operation to its own contract", () => {
    expect(
      readAgentWikiPageRequest("wiki.page.setTitle", {
        ...target,
        expectedRevision: 1,
        title: "T",
      }),
    ).toMatchObject({ field: "title" });
    expect(
      readAgentWikiPageRequest("wiki.page.setCover", {
        ...target,
        cover: null,
      }),
    ).toMatchObject({ cover: null });
    expect(
      readAgentWikiPageRequest("wiki.page.move", {
        ...target,
        expectedRevision: 1,
        projectId: "p",
        parentId: null,
        beforeId: null,
      }),
    ).toMatchObject({ projectId: "p" });
    expect(
      readAgentWikiPageRequest("wiki.page.patchContent", {
        ...target,
        expectedRevision: 1,
        start: { line: 1, column: 1 },
        end: { line: 1, column: 1 },
        expectedText: "",
        replacementText: "x",
      }),
    ).toMatchObject({ replacementText: "x" });
  });

  it("applies the contract of the operation, not of another one", () => {
    expectInvalidRequest(() =>
      readAgentWikiPageRequest("wiki.page.setCover", {
        ...target,
        expectedRevision: 1,
        title: "T",
      }),
    );
  });
});
