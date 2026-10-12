import { expect, it } from "vitest";

import {
  actAs,
  callTool,
  createTicket,
  listOf,
  NOT_FOUND,
  operationId,
  readTicket,
  textOf,
  useTicketHarness,
} from "../helpers/mcp-tickets";

import type { CreatedTicket, TicketHarness } from "../helpers/mcp-tickets";

const setup = useTicketHarness();

function addLink(
  harness: TicketHarness,
  ticketId: string,
  targetTicketId: string,
  linkType: string,
  id: string = operationId("link"),
): Promise<Record<string, unknown>> {
  return callTool(harness, "add_ticket_link", {
    operationId: id,
    ticketId,
    targetTicketId,
    linkType,
  });
}

function removeLink(
  harness: TicketHarness,
  ticketId: string,
  linkId: string,
  id: string = operationId("unlink"),
): Promise<Record<string, unknown>> {
  return callTool(harness, "remove_ticket_link", {
    operationId: id,
    ticketId,
    linkId,
  });
}

async function linksOf(
  harness: TicketHarness,
  ticketId: string,
): Promise<Record<string, unknown>[]> {
  return listOf(
    await callTool(harness, "read_ticket_links", { ticketId }),
    "links",
  );
}

async function pair(
  harness: TicketHarness,
): Promise<readonly [CreatedTicket, CreatedTicket]> {
  return [
    await createTicket(harness, { type: "task", title: "Left" }),
    await createTicket(harness, { type: "task", title: "Right" }),
  ];
}

it("creates a link that both tickets show with the same ID and the right direction", async () => {
  const harness = await setup();
  const [left, right] = await pair(harness);
  const created = await addLink(harness, left.key, right.key, "blocks");
  expect(created).toMatchObject({
    linkType: "blocks",
    direction: "outgoing",
    ticketId: left.id,
    key: left.key,
    linkedTicketId: right.id,
    linkedKey: right.key,
    removed: false,
  });
  const linkId = textOf(created, "linkId");
  const fromLeft = await linksOf(harness, left.id);
  const fromRight = await linksOf(harness, `/tasks/${right.key}`);
  expect(fromLeft).toEqual([
    expect.objectContaining({
      id: linkId,
      linkType: "blocks",
      direction: "outgoing",
      ticket: expect.objectContaining({
        id: right.id,
        key: right.key,
        title: "Right",
        isDone: false,
      }),
    }),
  ]);
  expect(fromRight).toEqual([
    expect.objectContaining({
      id: linkId,
      linkType: "blocks",
      direction: "incoming",
      ticket: expect.objectContaining({ id: left.id, key: left.key }),
    }),
  ]);
  expect(
    await callTool(harness, "read_ticket_links", { ticketId: left.id }),
  ).toMatchObject({ ticketId: left.id, key: left.key, total: 1 });
});

it("supports blocks, relates_to and duplicates, in both directions between the same tickets", async () => {
  const harness = await setup();
  const [left, right] = await pair(harness);
  for (const linkType of ["blocks", "relates_to", "duplicates"])
    expect(await addLink(harness, left.id, right.id, linkType)).toMatchObject({
      linkType,
      removed: false,
    });
  // The other direction of a directed type is another link, not a duplicate.
  expect(await addLink(harness, right.id, left.id, "blocks")).toMatchObject({
    direction: "outgoing",
    linkType: "blocks",
  });
  const links = await linksOf(harness, left.id);
  expect(
    links
      .map((link) => `${String(link.linkType)}:${String(link.direction)}`)
      .sort(),
  ).toEqual([
    "blocks:incoming",
    "blocks:outgoing",
    "duplicates:outgoing",
    "relates_to:outgoing",
  ]);
});

it("refuses a link to the ticket itself, a duplicate, an unknown type and invalid targets without writing", async () => {
  const harness = await setup();
  const [left, right] = await pair(harness);
  await addLink(harness, left.id, right.id, "relates_to");
  const before = await linksOf(harness, left.id);
  expect(await addLink(harness, left.id, left.key, "blocks")).toEqual({
    code: "INVALID_REQUEST",
  });
  expect(await addLink(harness, left.id, right.id, "relates_to")).toEqual({
    code: "CONFLICT",
  });
  // Relating has no direction: the same link from the other side is a duplicate too.
  expect(await addLink(harness, right.id, left.id, "relates_to")).toEqual({
    code: "CONFLICT",
  });
  expect(await addLink(harness, left.id, right.id, "depends_on")).toEqual({
    code: "INVALID_REQUEST",
  });
  expect(await addLink(harness, left.id, "has spaces", "blocks")).toEqual({
    code: "INVALID_REQUEST",
  });
  expect(
    await callTool(harness, "add_ticket_link", {
      operationId: operationId(),
      ticketId: left.id,
      targetTicketId: right.id,
      linkType: "blocks",
      extra: true,
    }),
  ).toEqual({ code: "INVALID_REQUEST" });
  expect(
    await addLink(harness, left.id, "no-such-ticket", "blocks"),
  ).toMatchObject({ code: "NOT_FOUND" });
  expect(
    await addLink(harness, "no-such-ticket", right.id, "blocks"),
  ).toMatchObject({ code: "NOT_FOUND" });
  await harness.database.execute(
    "UPDATE work_items SET archived_at = utc_now() WHERE id = $id;",
    { id: right.id },
  );
  expect(await addLink(harness, left.id, right.id, "blocks")).toEqual({
    code: "INVALID_REQUEST",
  });
  expect(await linksOf(harness, left.id)).toEqual(before);
});

it("gives a hidden target no trace and refuses the write right-less account", async () => {
  const harness = await setup();
  const [left, right] = await pair(harness);
  const hidden = await createTicket(harness, {
    type: "task",
    title: "Secret",
    departmentId: "beta",
  });
  actAs(harness, "writer");
  const missing = await addLink(harness, left.id, "no-such-ticket", "blocks");
  expect(missing).toMatchObject({ code: "NOT_FOUND" });
  expect(await addLink(harness, left.id, hidden.id, "blocks")).toEqual(missing);
  expect(await addLink(harness, left.id, hidden.key, "blocks")).toEqual(
    missing,
  );
  expect(
    await callTool(harness, "read_ticket_links", { ticketId: hidden.id }),
  ).toMatchObject({ code: "NOT_FOUND" });

  actAs(harness, "reader");
  expect(await addLink(harness, left.id, right.id, "blocks")).toEqual({
    code: "FORBIDDEN",
  });
  // Reading links needs no write right.
  expect(
    await callTool(harness, "read_ticket_links", { ticketId: left.id }),
  ).toMatchObject({ total: 0, links: [] });
});

it("keeps links to hidden tickets out of the list and the count, and cannot remove them", async () => {
  const harness = await setup();
  const [left] = await pair(harness);
  const hidden = await createTicket(harness, {
    type: "task",
    title: "Secret",
    departmentId: "beta",
  });
  const visibleTarget = await createTicket(harness, { type: "task" });
  const secretLink = await addLink(harness, left.id, hidden.id, "blocks");
  await addLink(harness, left.id, visibleTarget.id, "relates_to");
  expect(
    await callTool(harness, "read_ticket_links", { ticketId: left.id }),
  ).toMatchObject({ total: 2 });

  actAs(harness, "writer");
  const seen = await callTool(harness, "read_ticket_links", {
    ticketId: left.id,
  });
  expect(seen).toMatchObject({ total: 1 });
  expect(JSON.stringify(seen)).not.toContain("Secret");
  expect(JSON.stringify(seen)).not.toContain(textOf(secretLink, "linkId"));
  const missing = await removeLink(harness, left.id, "no-such-link");
  expect(missing).toEqual(NOT_FOUND);
  expect(
    await removeLink(harness, left.id, textOf(secretLink, "linkId")),
  ).toEqual(missing);
  actAs(harness, "owner");
  expect(await linksOf(harness, left.id)).toHaveLength(2);
});

it("removes a link from either side, once, and leaves other links and the tickets alone", async () => {
  const harness = await setup();
  const [left, right] = await pair(harness);
  const third = await createTicket(harness, { type: "task", title: "Third" });
  const blocks = await addLink(harness, left.id, right.id, "blocks");
  const relates = await addLink(harness, left.id, third.id, "relates_to");
  const otherSide = await addLink(harness, right.id, third.id, "duplicates");

  // The other ticket removes it: the link is the same one.
  const removed = await removeLink(harness, right.id, textOf(blocks, "linkId"));
  expect(removed).toMatchObject({
    linkId: textOf(blocks, "linkId"),
    linkType: "blocks",
    direction: "incoming",
    ticketId: right.id,
    linkedTicketId: left.id,
    removed: true,
  });
  expect((await linksOf(harness, left.id)).map((link) => link.id)).toEqual([
    textOf(relates, "linkId"),
  ]);
  expect((await linksOf(harness, right.id)).map((link) => link.id)).toEqual([
    textOf(otherSide, "linkId"),
  ]);
  expect(await removeLink(harness, right.id, textOf(blocks, "linkId"))).toEqual(
    NOT_FOUND,
  );
  // A link of other tickets cannot be removed through this ticket.
  expect(
    await removeLink(harness, left.id, textOf(otherSide, "linkId")),
  ).toEqual(NOT_FOUND);
  expect(await linksOf(harness, third.id)).toHaveLength(2);
  expect(await readTicket(harness, left.id)).toMatchObject({
    title: "Left",
    parentId: null,
  });
  // The link can be created again afterwards, as a new link.
  const again = await addLink(harness, left.id, right.id, "blocks");
  expect(textOf(again, "linkId")).not.toBe(textOf(blocks, "linkId"));
});

it("recovers a lost response with the same operation ID and refuses changed input under it", async () => {
  const harness = await setup();
  actAs(harness, "writer");
  const [left, right] = await pair(harness);
  const id = operationId("link-replay");
  const first = await addLink(harness, left.id, right.id, "blocks", id);
  expect(await addLink(harness, left.id, right.id, "blocks", id)).toEqual(
    first,
  );
  expect(await linksOf(harness, left.id)).toHaveLength(1);
  expect(await addLink(harness, left.id, right.id, "duplicates", id)).toEqual({
    code: "CONFLICT",
  });
  const removal = operationId("unlink-replay");
  const removed = await removeLink(
    harness,
    left.id,
    textOf(first, "linkId"),
    removal,
  );
  expect(removed).toMatchObject({ removed: true });
  expect(
    await removeLink(harness, left.id, textOf(first, "linkId"), removal),
  ).toEqual(removed);
  expect(await linksOf(harness, left.id)).toEqual([]);
  // The stored result is shown again only while both tickets are visible.
  await harness.database.execute(
    "UPDATE work_items SET department_id = 'beta' WHERE id = $id;",
    { id: right.id },
  );
  expect(
    await removeLink(harness, left.id, textOf(first, "linkId"), removal),
  ).toEqual(NOT_FOUND);
});

it("moves the parent and the links independently of each other", async () => {
  const harness = await setup();
  const epic = await createTicket(harness, { type: "epic", title: "Epic" });
  const other = await createTicket(harness, { type: "epic", title: "Other" });
  const task = await createTicket(harness, {
    type: "task",
    title: "Task",
    parentId: epic.id,
  });
  await addLink(harness, task.id, other.id, "relates_to");
  await callTool(harness, "set_ticket_parent", {
    operationId: operationId(),
    ticketId: task.id,
    expectedParentId: epic.id,
    parentId: other.id,
  });
  expect(await readTicket(harness, task.id)).toMatchObject({
    parentId: other.id,
  });
  expect(await linksOf(harness, task.id)).toHaveLength(1);
  const link = (await linksOf(harness, task.id))[0];
  await removeLink(harness, task.id, textOf(link ?? {}, "id"));
  expect(await readTicket(harness, task.id)).toMatchObject({
    parentId: other.id,
  });
});
