import { beforeEach, describe, expect, it } from "vitest";

import { ownerOperations } from "@/backend/service/mcp/AgentOperationCatalog";
import { PAGES_AGENT_WRITE_OPERATIONS } from "@/definition/PagesAgentWrites";

import {
  CHECKLIST_DESCRIPTION,
  CHECKLIST_TICKET_ID,
  CHECKLIST_TICKET_KEY,
  ChecklistWorld,
  isBulkResult,
} from "./page75-checklist-world";

import type { AgentTicketChecklist } from "@/definition/AgentTicketChecklist";

let world = new ChecklistWorld();
let operationCounter = 0;

beforeEach(() => {
  world = new ChecklistWorld();
  operationCounter = 0;
});

function idOf(checklist: AgentTicketChecklist, text: string): string {
  const entry = checklist.items.find((item) => item.text === text);
  if (!entry) throw new Error(`No checklist entry "${text}"`);
  return entry.id;
}

/** Builds the bulk payload from a read list, as an agent would, naming only the given texts. */
function payload(
  checklist: AgentTicketChecklist,
  states: Readonly<Record<string, boolean>>,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  operationCounter += 1;
  return {
    operationId: `batch-${operationCounter}`,
    ticketId: CHECKLIST_TICKET_KEY,
    expectedRevision: checklist.revision,
    items: Object.entries(states).map(([text, checked]) => ({
      itemId: idOf(checklist, text),
      checked,
    })),
    ...overrides,
  };
}

async function setItems(
  userId: string,
  parameters: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  return world.call(userId, "ticket.checklist.setItems", parameters);
}

describe("ticket.checklist.read as the basis of a bulk change", () => {
  it("returns the complete structured checklist with one call", async () => {
    const checklist = await world.read();
    expect(checklist).toMatchObject({
      ticketId: CHECKLIST_TICKET_ID,
      key: CHECKLIST_TICKET_KEY,
      link: `/tasks/${CHECKLIST_TICKET_KEY}`,
      revision: "1",
    });
    expect(
      checklist.items.map(
        ({ source, text, checked, order, depth, parentId }) => ({
          source,
          text,
          checked,
          order,
          depth,
          parentId: parentId === null ? null : "parent",
        }),
      ),
    ).toEqual([
      {
        source: "description",
        text: "Parent task",
        checked: false,
        order: 0,
        depth: 0,
        parentId: null,
      },
      {
        source: "description",
        text: "Nested task",
        checked: false,
        order: 1,
        depth: 1,
        parentId: "parent",
      },
      {
        source: "description",
        text: "Done nested task",
        checked: true,
        order: 2,
        depth: 1,
        parentId: "parent",
      },
      {
        source: "description",
        text: "Second task",
        checked: false,
        order: 3,
        depth: 0,
        parentId: null,
      },
      {
        source: "criteria",
        text: "Criterion A",
        checked: false,
        order: 4,
        depth: 0,
        parentId: null,
      },
      {
        source: "criteria",
        text: "Criterion B",
        checked: true,
        order: 5,
        depth: 0,
        parentId: null,
      },
    ]);
    const parent = idOf(checklist, "Parent task");
    expect(checklist.items[1]?.parentId).toBe(parent);
    expect(checklist.items[2]?.parentId).toBe(parent);
  });
});

describe("ticket.checklist.setItems applies a bulk change", () => {
  it("sets several states with one call and returns the complete list with the new revision", async () => {
    const before = await world.read();
    const result = await setItems(
      "writer",
      payload(before, {
        "Nested task": true,
        "Done nested task": false,
        "Criterion A": true,
        "Criterion B": true,
      }),
    );

    if (!isBulkResult(result)) throw new Error("Unexpected bulk result");
    const { changedCount, ...after } = result;
    expect(after).toMatchObject({
      ticketId: CHECKLIST_TICKET_ID,
      key: CHECKLIST_TICKET_KEY,
      link: `/tasks/${CHECKLIST_TICKET_KEY}`,
      revision: "2",
    });
    expect(changedCount).toBe(3);
    expect(after.items.map(({ text, checked }) => [text, checked])).toEqual([
      ["Parent task", false],
      ["Nested task", true],
      ["Done nested task", false],
      ["Second task", false],
      ["Criterion A", true],
      ["Criterion B", true],
    ]);
    // Ids, order and hierarchy survive the change; only the states differ.
    expect(
      after.items.map(({ id, order, depth, parentId }) => [
        id,
        order,
        depth,
        parentId,
      ]),
    ).toEqual(
      before.items.map(({ id, order, depth, parentId }) => [
        id,
        order,
        depth,
        parentId,
      ]),
    );
    // A later read shows exactly the list the change returned, minus its counter.
    expect(await world.read()).toEqual(after);
  });

  it("changes only the named checkbox characters and leaves every other ticket content as it was", async () => {
    const before = await world.read();
    const original = world.ticket;
    await setItems(
      "writer",
      payload(before, { "Nested task": true, "Criterion A": true }),
    );

    expect(world.ticket).toEqual({
      ...original,
      description: CHECKLIST_DESCRIPTION.replace(
        "  - [ ] Nested task",
        "  - [x] Nested task",
      ),
    });
    expect(world.ticket.description.endsWith("Closing paragraph.\n")).toBe(
      true,
    );
    expect(world.writes).toEqual({ criteria: 1, descriptions: 1 });
    expect(world.criteria.map(({ title, isDone }) => [title, isDone])).toEqual([
      ["Criterion A", true],
      ["Criterion B", true],
    ]);
    expect(world.events).toEqual([
      { type: "ticket.updated", id: CHECKLIST_TICKET_ID },
    ]);
  });

  it("writes nothing and keeps the revision when every entry already has its state", async () => {
    const before = await world.read();
    const { ticket, criteria } = world;
    const result = await setItems(
      "writer",
      payload(before, { "Parent task": false, "Done nested task": true }),
    );
    expect(result).toMatchObject({
      revision: before.revision,
      changedCount: 0,
    });
    expect(world.ticket).toBe(ticket);
    expect(world.criteria).toEqual(criteria);
    expect(world.writes).toEqual({ criteria: 0, descriptions: 0 });
    expect(world.events).toEqual([]);
  });
});

describe("ticket.checklist.setItems refusals", () => {
  it("refuses a stale revision, a repeated id, an unknown id and bad values without changing anything", async () => {
    const before = await world.read();
    const stored = world.stored();
    const nested = idOf(before, "Nested task");

    await expect(
      setItems(
        "writer",
        payload(before, { "Nested task": true }, { expectedRevision: "0" }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      setItems(
        "writer",
        payload(
          before,
          {},
          {
            items: [
              { itemId: nested, checked: true },
              { itemId: nested, checked: false },
            ],
          },
        ),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      details: { reason: "checklist_item_duplicate" },
    });
    await expect(
      setItems(
        "writer",
        payload(
          before,
          {},
          {
            items: [
              { itemId: nested, checked: true },
              { itemId: "md-unknown", checked: true },
            ],
          },
        ),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      details: { reason: "checklist_item_unknown" },
    });
    for (const items of [
      [],
      [{ itemId: nested, checked: "yes" }],
      [{ itemId: nested }],
      "all",
    ]) {
      await expect(
        setItems("writer", payload(before, {}, { items })),
      ).rejects.toMatchObject({
        code: "INVALID_REQUEST",
        details: { reason: "checklist_items_invalid" },
      });
    }
    expect(world.stored()).toEqual(stored);
  });

  it("rolls back criteria that were already written when the description write fails", async () => {
    const before = await world.read();
    const stored = world.stored();
    world.isDescriptionWriteFailing = true;
    await expect(
      setItems(
        "writer",
        payload(before, { "Criterion A": true, "Nested task": true }),
      ),
    ).rejects.toThrow("Synthetic storage failure");

    expect(world.stored()).toEqual(stored);
    world.isDescriptionWriteFailing = false;
    expect(await world.read()).toEqual(before);
  });

  it("needs the write right like the single-entry change and is offered with it", async () => {
    const before = await world.read("reader");
    const stored = world.stored();
    await expect(
      setItems("reader", payload(before, { "Nested task": true })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(world.stored()).toEqual(stored);
    expect(PAGES_AGENT_WRITE_OPERATIONS).toContain("ticket.checklist.setItems");
    expect(ownerOperations(false)).toContain("ticket.checklist.setItems");
  });
});

describe("ticket.checklist.setItem next to the bulk change", () => {
  it("keeps the single-entry change working and chains with the revision it returns", async () => {
    const before = await world.read();
    const single = await world.call("writer", "ticket.checklist.setItem", {
      operationId: "single-1",
      ticketId: CHECKLIST_TICKET_KEY,
      itemId: idOf(before, "Second task"),
      checked: true,
      expectedRevision: before.revision,
    });
    expect(single).toMatchObject({ changed: true, revision: "2" });

    const middle = await world.read();
    const bulk = await setItems(
      "writer",
      payload(middle, { "Second task": false, "Criterion A": true }),
    );
    expect(bulk).toMatchObject({ revision: "3", changedCount: 2 });
  });
});
