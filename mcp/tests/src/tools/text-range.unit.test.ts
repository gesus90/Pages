import { describe, expect, it } from "vitest";

import { READ_TOOLS } from "../../../src/tools/registry.ts";
import { WRITE_TOOLS } from "../../../src/tools/write-registry.ts";

interface ToolLike {
  name: string;
  inputSchema: {
    required?: string[];
    additionalProperties?: boolean;
    properties?: Record<string, unknown>;
  };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

const toolOf = (entry: unknown): ToolLike =>
  ((entry as { tool?: ToolLike }).tool ?? entry) as ToolLike;
const readTools = (READ_TOOLS as unknown[]).map(toolOf);
const writeTools = (WRITE_TOOLS as unknown[]).map(toolOf);

const READ_RANGE = [
  { name: "read_wiki_page_range", target: "pageId" },
  { name: "read_ticket_description_range", target: "ticketId" },
] as const;

const PATCH_RANGE = [
  {
    name: "patch_wiki_page_content",
    target: "pageId",
    version: "expectedRevision",
  },
  {
    name: "patch_ticket_description",
    target: "ticketId",
    version: "expectedDescriptionVersion",
  },
] as const;

describe.each(READ_RANGE)("$name", ({ name, target }) => {
  const tool = readTools.find((t) => t.name === name);

  it("is registered as a read-only tool", () => {
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.annotations?.destructiveHint).toBe(false);
  });

  it("requires the target and a start position and rejects unknown fields", () => {
    expect(tool?.inputSchema.required).toEqual([target, "start"]);
    expect(tool?.inputSchema.additionalProperties).toBe(false);
  });
});

describe.each(PATCH_RANGE)("$name", ({ name, target, version }) => {
  const tool = writeTools.find((t) => t.name === name);

  it("is registered as a write tool", () => {
    expect(tool?.annotations?.readOnlyHint).toBe(false);
  });

  it("requires the exact range, its expected text and the replacement", () => {
    expect(tool?.inputSchema.required).toEqual([
      "operationId",
      target,
      version,
      "start",
      "end",
      "expectedText",
      "replacementText",
    ]);
    expect(tool?.inputSchema.additionalProperties).toBe(false);
  });

  it("needs both line and column for start and end", () => {
    const position = tool?.inputSchema.properties?.start as {
      required?: string[];
    };
    expect(position.required).toEqual(["line", "column"]);
  });
});
