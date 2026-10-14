import assert from "node:assert/strict";
import { test } from "node:test";

import { WRITE_TOOLS } from "../src/tools/write-registry.ts";

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

for (const expected of ARCHIVE_TOOLS) {
  await test(`${expected.name} retains its name, operation, schema and annotations`, () => {
    const entry = WRITE_TOOLS.find(({ tool }) => tool.name === expected.name);
    assert.ok(entry);
    assert.equal(entry.operation, expected.operation);
    assert.deepEqual(entry.tool.inputSchema.required, expected.keys);
    assert.deepEqual(
      Object.keys(entry.tool.inputSchema.properties ?? {}),
      expected.keys,
    );
    assert.equal(entry.tool.inputSchema.additionalProperties, false);
    assert.deepEqual(entry.tool.inputSchema.properties?.confirmation, {
      type: "string",
      enum: ["LÖSCHEN", "DELETE"],
    });
    assert.deepEqual(entry.tool.annotations, {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  await test(`${expected.name} describes soft archiving and per-call authorization`, () => {
    const description = WRITE_TOOLS.find(
      ({ tool }) => tool.name === expected.name,
    )?.tool.description;
    assert.ok(description);
    assert.match(description, /Soft archiving/);
    assert.match(description, /milestone management rights/);
    assert.match(description, /tools\/list grants no target permission/);
    assert.match(description, /including an operationId replay/);
    assert.match(description, /affectedCount/);
    if (expected.name === "delete_ticket")
      assert.match(description, /active descendants/);
    else
      assert.match(description, /preserves its tickets and their assignments/);
  });
}
