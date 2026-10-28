import { describe, expect, it } from "vitest";

import { READ_TOOLS } from "../../../src/tools/registry.ts";
import { COMMENT_TOOLS } from "../../../src/tools/wiki-comments.ts";
import { WRITE_TOOLS } from "../../../src/tools/write-registry.ts";

const ALL_TOOLS = [...READ_TOOLS, ...COMMENT_TOOLS, ...WRITE_TOOLS];
const READING_TOOLS = [
  ...READ_TOOLS,
  ...COMMENT_TOOLS.filter(
    ({ operation }) => operation === "wiki.comments.read",
  ),
];
const WRITING_TOOLS = [
  ...WRITE_TOOLS,
  ...COMMENT_TOOLS.filter(
    ({ operation }) => operation !== "wiki.comments.read",
  ),
];
const ADDITIVE_TOOL_NAMES = [
  "prepare_asset_upload",
  "create_wiki_page",
  "apply_wiki_import",
  "apply_structured_import",
  "create_project",
  "create_workspace",
  "create_plan",
  "clone_plan",
  "create_plan_parameter",
  "save_plan_template",
  "create_ticket",
  "create_milestone",
  "add_milestone_dependency",
  "add_milestone_initiative",
  "add_ticket_link",
  "add_wiki_comment",
];
const OPEN_WORLD_TOOL_NAMES = [
  "play_plan",
  "resume_plan",
  "release_plan_run",
  "restart_plan_run",
  "continue_plan_run",
];
const UNJOURNALED_TOOL_NAMES = ["delete_chat_sessions", "prepare_asset_upload"];

describe("tool registries", () => {
  it("assigns every tool name and operation exactly once", () => {
    const names = ALL_TOOLS.map(({ tool }) => tool.name);
    const operations = ALL_TOOLS.map(({ operation }) => operation);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(operations).size).toBe(operations.length);
    expect(operations).not.toContain("projects.names.list");
  });

  it.each(ALL_TOOLS.map(({ tool }) => [tool.name, tool] as const))(
    "%s has a title, a specific description and a strict object schema",
    (name, tool) => {
      expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(tool.title).toEqual(expect.stringMatching(/\S/));
      expect(tool.description).toEqual(expect.stringMatching(/\S/));
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      const properties = Object.keys(tool.inputSchema.properties ?? {});
      for (const key of tool.inputSchema.required ?? [])
        expect(properties).toContain(key);
      for (const key of properties)
        expect(key).toMatch(/^(?:[a-z][a-zA-Z0-9]*|expected_revision)$/);
      expect(
        ALL_TOOLS.filter(
          (entry) => entry.tool.description === tool.description,
        ),
      ).toHaveLength(1);
    },
  );
});

describe("tool annotations", () => {
  it.each(READING_TOOLS.map(({ tool }) => [tool.name, tool] as const))(
    "read tool %s is read-only, idempotent and limited to Pages records",
    (_, tool) => {
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    },
  );

  it.each(WRITING_TOOLS.map(({ tool }) => [tool.name, tool] as const))(
    "write tool %s marks replacements and removals as destructive and declares its scope and replay",
    (name, tool) => {
      expect(tool.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: !ADDITIVE_TOOL_NAMES.includes(name),
        idempotentHint: !UNJOURNALED_TOOL_NAMES.includes(name),
        openWorldHint: OPEN_WORLD_TOOL_NAMES.includes(name),
      });
    },
  );
});
