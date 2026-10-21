import { describe, expect, it } from "vitest";

import { READ_TOOLS } from "../../../src/tools/registry.ts";
import { WRITE_TOOLS } from "../../../src/tools/write-registry.ts";

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

describe("text range tools", () => {
  describe.each(READ_RANGE)("$name", ({ name, target }) => {
    const tool = READ_TOOLS.find((entry) => entry.tool.name === name)?.tool;

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
    const tool = WRITE_TOOLS.find((entry) => entry.tool.name === name)?.tool;

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
      expect(tool?.inputSchema.properties?.start).toMatchObject({
        required: ["line", "column"],
      });
    });
  });
});
