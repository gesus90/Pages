import { describe, expect, it } from "vitest";

import { WRITE_TOOLS } from "../../../src/tools/write-registry.ts";

const ARCHIVE_TOOLS = [
  {
    name: "delete_ticket",
    operation: "ticket.delete",
    keys: ["operationId", "ticketId", "confirmation"],
  },
  {
    name: "delete_milestone",
    operation: "milestone.delete",
    keys: ["operationId", "projectId", "milestoneId", "confirmation"],
  },
] as const;

describe.each(ARCHIVE_TOOLS)("$name", (expected) => {
  const entry = WRITE_TOOLS.find(({ tool }) => tool.name === expected.name);

  it("retains its name, operation, schema and annotations", () => {
    expect(entry?.operation).toBe(expected.operation);
    expect(entry?.tool.inputSchema.required).toEqual(expected.keys);
    expect(Object.keys(entry?.tool.inputSchema.properties ?? {})).toEqual(
      expected.keys,
    );
    expect(entry?.tool.inputSchema.additionalProperties).toBe(false);
    expect(entry?.tool.inputSchema.properties?.confirmation).toEqual({
      type: "string",
      enum: ["LÖSCHEN", "DELETE"],
    });
    expect(entry?.tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("describes soft archiving and per-call authorization", () => {
    const description = entry?.tool.description;
    expect(description).toMatch(/Soft archiving/);
    expect(description).toMatch(/milestone management rights/);
    expect(description).toMatch(/tools\/list grants no target permission/);
    expect(description).toMatch(/including an operationId replay/);
    expect(description).toMatch(/affectedCount/);
    expect(description).toMatch(
      expected.name === "delete_ticket"
        ? /active descendants/
        : /preserves its tickets and their assignments/,
    );
  });
});
