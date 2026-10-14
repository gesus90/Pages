import { describe, expect, it } from "vitest";

import { READ_TOOLS } from "../../../src/tools/registry.ts";
import { COMMENT_TOOLS } from "../../../src/tools/wiki-comments.ts";
import { WRITE_TOOLS } from "../../../src/tools/write-registry.ts";

const ALL_TOOLS = [...READ_TOOLS, ...COMMENT_TOOLS, ...WRITE_TOOLS];

describe("tool registries", () => {
  it("assign every tool name and operation exactly once", () => {
    const names = ALL_TOOLS.map(({ tool }) => tool.name);
    const operations = ALL_TOOLS.map(({ operation }) => operation);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(operations).size).toBe(operations.length);
    expect(operations).not.toContain("projects.names.list");
  });

  it.each(ALL_TOOLS.map(({ tool }) => [tool.name, tool] as const))(
    "%s has a described, strict object schema",
    (name, tool) => {
      expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(tool.description?.trim()).not.toBe("");
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      const properties = Object.keys(tool.inputSchema.properties ?? {});
      for (const key of tool.inputSchema.required ?? [])
        expect(properties).toContain(key);
    },
  );
});

describe("tool annotations", () => {
  it.each(READ_TOOLS.map(({ tool }) => [tool.name, tool] as const))(
    "read tool %s is read-only and not destructive",
    (_, tool) => {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
    },
  );

  it.each(WRITE_TOOLS.map(({ tool }) => [tool.name, tool] as const))(
    "write tool %s declares that it writes",
    (_, tool) => {
      expect(tool.annotations?.readOnlyHint).toBe(false);
      expect(tool.annotations?.openWorldHint).toBe(false);
    },
  );

  it("marks only removing write tools as destructive", () => {
    const destructive = WRITE_TOOLS.filter(
      ({ tool }) => tool.annotations?.destructiveHint,
    ).map(({ tool }) => tool.name);
    expect(destructive).toContain("delete_ticket");
    expect(destructive).not.toContain("create_wiki_page");
    expect(destructive).not.toContain("prepare_asset_upload");
  });
});
