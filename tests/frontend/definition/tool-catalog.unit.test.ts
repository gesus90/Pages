import { describe, expect, it } from "vitest";

import {
  ADDITIVE_ANNOTATIONS,
  DESTRUCTIVE_ANNOTATIONS,
  READ_ANNOTATIONS,
  buildReadTool,
  buildWriteTool,
} from "@/definition/AgentTools/ToolDefinition";
import { TOOL_ENTRIES } from "@/definition/AgentTools/ToolCatalog";

type Schema = Record<string, unknown>;

/** Every object schema nested anywhere inside a tool's input schema. */
function objectSchemas(schema: unknown, path = "$"): [string, Schema][] {
  if (typeof schema !== "object" || schema === null) return [];
  const record: Schema = { ...schema };
  const found: [string, Schema][] = [];
  const types = Array.isArray(record.type) ? record.type : [record.type];
  if (types.includes("object") && typeof record.properties === "object")
    found.push([path, record]);
  const nested = Object.entries(
    typeof record.properties === "object" && record.properties !== null
      ? record.properties
      : {},
  ).flatMap(([name, child]) => objectSchemas(child, `${path}.${name}`));
  const items = objectSchemas(record.items, `${path}[]`);
  const variants = ["anyOf", "oneOf", "allOf"].flatMap((keyword) => {
    const list = record[keyword];
    return Array.isArray(list)
      ? list.flatMap((variant, index) =>
          objectSchemas(variant, `${path}.${keyword}[${index}]`),
        )
      : [];
  });
  return [...found, ...nested, ...items, ...variants];
}

/** One property of one object schema of one tool. */
interface LocatedProperty {
  readonly tool: string;
  readonly path: string;
  readonly name: string;
  readonly property: unknown;
}

function propertiesOf(schema: Schema): [string, unknown][] {
  return Object.entries(
    typeof schema.properties === "object" && schema.properties !== null
      ? schema.properties
      : {},
  );
}

describe("the MCP tool catalog", () => {
  const tools = TOOL_ENTRIES.map((entry) => entry.tool);
  const objects = tools.flatMap((tool) =>
    objectSchemas(tool.inputSchema).map(([path, schema]) => ({
      tool: tool.name,
      path,
      schema,
    })),
  );
  const properties: LocatedProperty[] = objects.flatMap((object) =>
    propertiesOf(object.schema).map(([name, property]) => ({
      tool: object.tool,
      path: object.path,
      name,
      property,
    })),
  );

  it("offers unique snake_case tool names and one unique operation per tool", () => {
    const names = tools.map((tool) => tool.name);
    const operations = TOOL_ENTRIES.map((entry) => entry.operation);

    expect(tools.length).toBeGreaterThan(100);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(operations).size).toBe(operations.length);
    for (const name of names)
      expect(name).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u);
  });

  it("describes every tool with a title and a description", () => {
    for (const tool of tools) {
      expect(tool.title?.trim(), tool.name).toBeTruthy();
      expect(tool.description?.trim().length, tool.name).toBeGreaterThan(20);
    }
  });

  it("closes the input of every tool and of every nested object", () => {
    for (const object of objects)
      expect(
        object.schema.additionalProperties,
        `${object.tool} ${object.path}`,
      ).toBe(false);
  });

  it("requires only properties that exist", () => {
    for (const object of objects) {
      const names = propertiesOf(object.schema).map(([name]) => name);
      const required = Array.isArray(object.schema.required)
        ? object.schema.required
        : [];
      for (const key of required)
        expect(names, `${object.tool} ${object.path}`).toContain(key);
    }
  });

  it("bounds every identifier property", () => {
    const identifiers = properties.filter(
      ({ name, property }) =>
        /Ids?$/u.test(name) &&
        typeof property === "object" &&
        property !== null &&
        !("items" in property),
    );

    for (const { tool, path, name, property } of identifiers) {
      const isBounded = [
        "maxLength",
        "enum",
        "format",
        "pattern",
        "const",
      ].some(
        (keyword) =>
          typeof property === "object" &&
          property !== null &&
          keyword in property,
      );
      expect(isBounded, `${tool} ${path}.${name}`).toBe(true);
    }
  });

  it("marks reads as read-only and requires an operation id for every write", () => {
    // These writes are not replayed by an operation id: a chat deletion is
    // bound to the person's own confirmation, an upload to its one-use ticket,
    // and the ticket work record to its expected metadata revision.
    const withoutOperationId = [
      "delete_chat_sessions",
      "prepare_asset_upload",
      "save_ticket_work",
    ];
    for (const tool of tools) {
      const names = Object.keys(tool.inputSchema.properties ?? {});
      if (tool.annotations?.readOnlyHint === true) {
        expect(tool.annotations.destructiveHint, tool.name).toBe(false);
        expect(names, tool.name).not.toContain("operationId");
      } else {
        expect(tool.annotations?.readOnlyHint, tool.name).toBe(false);
        if (!withoutOperationId.includes(tool.name))
          expect(tool.inputSchema.required, tool.name).toContain("operationId");
      }
    }
    const ticketWork = tools.find((tool) => tool.name === "save_ticket_work");
    expect(ticketWork?.inputSchema.required).toContain("expectedRevision");
  });

  it("names every property in camelCase except the one legacy wiki revision", () => {
    // The wiki deletion kept the snake_case name its first clients use.
    const legacy = new Set(["expected_revision"]);

    for (const { tool, path, name } of properties)
      if (!legacy.has(name))
        expect(name, `${tool} ${path}`).toMatch(/^[a-z][A-Za-z0-9]*$/u);
  });
});

describe("building tools", () => {
  it("builds a read tool that is closed, read-only and requires what it names", () => {
    const tool = buildReadTool({
      name: "read_thing",
      title: "Read thing",
      description: "Reads a thing.",
      properties: { thingId: { type: "string" } },
      required: ["thingId"],
    });
    const optional = buildReadTool({
      name: "list_things",
      title: "List things",
      description: "Lists things.",
      properties: {},
    });

    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: { thingId: { type: "string" } },
      required: ["thingId"],
      additionalProperties: false,
    });
    expect(tool.annotations).toBe(READ_ANNOTATIONS);
    expect(optional.inputSchema).not.toHaveProperty("required");
  });

  it("builds a write tool that requires an operation id and every property but the optional ones", () => {
    const additive = buildWriteTool({
      name: "set_thing",
      title: "Set thing",
      description: "Sets a thing.",
      properties: { thingId: { type: "string" }, note: { type: "string" } },
      optionalKeys: ["note"],
      isDestructive: false,
    });
    const destructive = buildWriteTool({
      name: "delete_thing",
      title: "Delete thing",
      description: "Deletes a thing.",
      properties: { thingId: { type: "string" } },
      isDestructive: true,
      isOpenWorld: true,
    });

    expect(additive.inputSchema.required).toEqual(["operationId", "thingId"]);
    expect(Object.keys(additive.inputSchema.properties ?? {})).toEqual([
      "operationId",
      "thingId",
      "note",
    ]);
    expect(additive.annotations).toEqual(ADDITIVE_ANNOTATIONS);
    expect(destructive.annotations).toEqual({
      ...DESTRUCTIVE_ANNOTATIONS,
      openWorldHint: true,
    });
  });
});
