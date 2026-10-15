import { describe, expect, it } from "vitest";

import {
  readAgentMilestonesRead,
  readAgentTicketDescriptionPatch,
  readAgentTicketDescriptionRange,
} from "@/backend/service/agents/AgentTicketValidation";

import {
  expectInvalidRequest,
  expectTooLarge,
} from "./operation-error-expectation";

const VERSION = "0123456789abcdef0123456789abcdef";

describe("readAgentTicketDescriptionRange", () => {
  it("defaults the column, the end and the budget", () => {
    expect(
      readAgentTicketDescriptionRange({
        ticketId: "PAGE-1",
        start: { line: 3 },
      }),
    ).toEqual({
      ticket: { key: "PAGE-1" },
      range: {
        start: { line: 3, column: 1 },
        end: null,
        maxCharacters: 4_096,
      },
    });
  });

  it("reads an explicit end and budget", () => {
    const result = readAgentTicketDescriptionRange({
      ticketId: "PAGE-1",
      start: { line: 1, column: 4 },
      end: { line: 2 },
      maxCharacters: 100,
    });
    expect(result.range).toEqual({
      start: { line: 1, column: 4 },
      end: { line: 2, column: 1 },
      maxCharacters: 100,
    });
  });

  it("accepts the largest budget and refuses one more, naming the limit", () => {
    const call = (maxCharacters: number): unknown =>
      readAgentTicketDescriptionRange({
        ticketId: "PAGE-1",
        start: { line: 1 },
        maxCharacters,
      });
    expect(call(16_384)).toBeDefined();
    expectTooLarge(() => call(16_385), {
      constraint: "textRangeCharacters",
      limit: 16_384,
    });
  });

  it.each([
    ["a line of zero", { line: 0 }],
    ["a negative line", { line: -1 }],
    ["a fractional line", { line: 1.5 }],
    ["a line given as text", { line: "1" }],
    ["a column of zero", { line: 1, column: 0 }],
    ["an unknown position field", { line: 1, offset: 4 }],
    ["a position that is not an object", 3],
  ])("refuses a start with %s", (_, start) => {
    expectInvalidRequest(() =>
      readAgentTicketDescriptionRange({ ticketId: "PAGE-1", start }),
    );
  });

  it.each([
    ["a missing start", { ticketId: "PAGE-1" }],
    ["a missing ticket", { start: { line: 1 } }],
    ["an unknown parameter", { ticketId: "PAGE-1", start: { line: 1 }, x: 1 }],
    [
      "a zero budget",
      { ticketId: "PAGE-1", start: { line: 1 }, maxCharacters: 0 },
    ],
  ])("refuses %s", (_, input) => {
    expectInvalidRequest(() => readAgentTicketDescriptionRange(input));
  });
});

describe("readAgentTicketDescriptionPatch", () => {
  const patch = {
    operationId: "op-1",
    ticketId: "PAGE-1",
    expectedDescriptionVersion: VERSION,
    start: { line: 1, column: 1 },
    end: { line: 1, column: 6 },
    expectedText: "Hello",
    replacementText: "Howdy",
  };

  it("returns the exact range with its expected and replacement text", () => {
    expect(readAgentTicketDescriptionPatch(patch)).toEqual({
      operationId: "op-1",
      ticket: { key: "PAGE-1" },
      expectedVersion: VERSION,
      start: { line: 1, column: 1 },
      end: { line: 1, column: 6 },
      expectedText: "Hello",
      replacementText: "Howdy",
      includeAfter: false,
    });
  });

  it("reads includeAfter and accepts an empty replacement as a deletion", () => {
    const result = readAgentTicketDescriptionPatch({
      ...patch,
      replacementText: "",
      includeAfter: true,
    });
    expect(result.includeAfter).toBe(true);
    expect(result.replacementText).toBe("");
  });

  it.each([
    [
      "an uppercase version",
      { expectedDescriptionVersion: VERSION.toUpperCase() },
    ],
    ["a short version", { expectedDescriptionVersion: VERSION.slice(1) }],
    ["a long version", { expectedDescriptionVersion: `${VERSION}0` }],
    ["a non-hex version", { expectedDescriptionVersion: "g".repeat(32) }],
    ["a numeric version", { expectedDescriptionVersion: 1 }],
    ["a start without a column", { start: { line: 1 } }],
    ["an end that is a string", { end: "1:6" }],
    ["expected text that is not a string", { expectedText: 5 }],
    ["a replacement that is null", { replacementText: null }],
    ["includeAfter as a string", { includeAfter: "yes" }],
    ["the complete description as an extra field", { description: "all" }],
  ])("refuses %s", (_, change) => {
    expectInvalidRequest(() =>
      readAgentTicketDescriptionPatch({ ...patch, ...change }),
    );
  });

  it.each(["operationId", "ticketId", "expectedText", "end"])(
    "refuses a patch without %s",
    (name) => {
      const incomplete = Object.fromEntries(
        Object.entries(patch).filter(([key]) => key !== name),
      );
      expectInvalidRequest(() => readAgentTicketDescriptionPatch(incomplete));
    },
  );
});

describe("readAgentMilestonesRead", () => {
  it("returns the project identifier", () => {
    expect(readAgentMilestonesRead({ projectId: "project-1" })).toBe(
      "project-1",
    );
  });

  it.each([{}, { projectId: "" }, { projectId: "p", extra: 1 }, null])(
    "refuses %j",
    (input) => {
      expectInvalidRequest(() => readAgentMilestonesRead(input));
    },
  );
});
