import { describe, expect, it } from "vitest";

import { READ_TOOLS } from "../../../src/tools/registry.ts";
import { WRITE_TOOLS } from "../../../src/tools/write-registry.ts";

const READ = READ_TOOLS.find(
  ({ operation }) => operation === "ticket.checklist.read",
);
const SET_ONE = WRITE_TOOLS.find(
  ({ operation }) => operation === "ticket.checklist.setItem",
);
const SET_MANY = WRITE_TOOLS.find(
  ({ operation }) => operation === "ticket.checklist.setItems",
);

describe("ticket checklist tools", () => {
  it("keeps the single-entry tool unchanged next to the bulk tool", () => {
    expect(SET_ONE?.tool.name).toBe("set_ticket_checklist_item");
    expect(SET_ONE?.tool.inputSchema.required).toEqual([
      "operationId",
      "ticketId",
      "itemId",
      "checked",
      "expectedRevision",
    ]);
  });

  it("offers the bulk change as one write tool with a strict list of entries", () => {
    expect(SET_MANY?.tool.name).toBe("set_ticket_checklist_items");
    const schema = SET_MANY?.tool.inputSchema;
    expect(schema?.required).toEqual([
      "operationId",
      "ticketId",
      "expectedRevision",
      "items",
    ]);
    expect(schema?.additionalProperties).toBe(false);
    expect(schema?.properties?.items).toEqual({
      type: "array",
      minItems: 1,
      maxItems: 500,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          itemId: { type: "string", minLength: 1, maxLength: 200 },
          checked: { type: "boolean" },
        },
        required: ["itemId", "checked"],
      },
    });
    expect(SET_MANY?.tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("documents atomic application, preserved entries, the result and every refusal", () => {
    const description = SET_MANY?.tool.description ?? "";
    expect(description).toMatch(/applied atomically/);
    expect(description).toMatch(/entries you leave out/);
    expect(description).toMatch(/complete checklist after the call/);
    for (const reason of [
      "checklist_items_invalid",
      "checklist_item_duplicate",
      "checklist_item_unknown",
    ])
      expect(description).toContain(reason);
    expect(description).toMatch(/CONFLICT/);
    expect(description).toMatch(/FORBIDDEN/);
  });

  it("points the read tool at the bulk change and keeps its one-call contract", () => {
    const description = READ?.tool.description ?? "";
    expect(description).toMatch(/complete checklist/);
    expect(description).toContain("set_ticket_checklist_items");
    expect(READ?.tool.inputSchema.required).toEqual(["ticketId"]);
  });
});
