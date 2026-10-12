import { expect, it } from "vitest";

import {
  actAs,
  callTool,
  collectPages,
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

interface Hierarchy {
  readonly initiative: CreatedTicket;
  readonly epic: CreatedTicket;
  readonly task: CreatedTicket;
  readonly subtask: CreatedTicket;
  readonly otherEpic: CreatedTicket;
  readonly otherTask: CreatedTicket;
}

/** Initiative > epic > task > subtask, and a second epic with a task below the same initiative. */
async function buildHierarchy(harness: TicketHarness): Promise<Hierarchy> {
  const initiative = await createTicket(harness, {
    type: "initiative",
    title: "Initiative",
  });
  const epic = await createTicket(harness, {
    type: "epic",
    title: "Epic",
    parentId: initiative.id,
  });
  const task = await createTicket(harness, {
    type: "task",
    title: "Task",
    parentId: epic.id,
  });
  const subtask = await createTicket(harness, {
    type: "subtask",
    title: "Subtask",
    parentId: task.id,
  });
  const otherEpic = await createTicket(harness, {
    type: "epic",
    title: "Other epic",
    parentId: initiative.id,
  });
  const otherTask = await createTicket(harness, {
    type: "task",
    title: "Other task",
    parentId: otherEpic.id,
  });
  return { initiative, epic, task, subtask, otherEpic, otherTask };
}

function tree(
  harness: TicketHarness,
  parameters: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return callTool(harness, "read_ticket_tree", parameters);
}

function setParent(
  harness: TicketHarness,
  ticketId: string,
  expectedParentId: string | null,
  parentId: string | null,
  id: string = operationId("parent"),
): Promise<Record<string, unknown>> {
  return callTool(harness, "set_ticket_parent", {
    operationId: id,
    ticketId,
    expectedParentId,
    parentId,
  });
}

function nodesByKey(
  result: Record<string, unknown>,
): Map<string, Record<string, unknown>> {
  return new Map(
    listOf(result, "nodes").map((node) => [textOf(node, "key"), node]),
  );
}

it("reads the whole project hierarchy with matching parent and child references", async () => {
  const harness = await setup();
  const h = await buildHierarchy(harness);
  const result = await tree(harness, { projectId: "p1" });
  expect(result).toMatchObject({
    projectId: "p1",
    root: null,
    path: [],
    total: 6,
    nextCursor: null,
  });
  const nodes = nodesByKey(result);
  expect(nodes.get(h.initiative.key)).toMatchObject({
    id: h.initiative.id,
    type: "initiative",
    parentId: null,
    parentKey: null,
    childCount: 2,
    depth: 0,
  });
  expect(nodes.get(h.epic.key)).toMatchObject({
    parentId: h.initiative.id,
    parentKey: h.initiative.key,
    childCount: 1,
    depth: 1,
  });
  expect(nodes.get(h.task.key)).toMatchObject({
    parentId: h.epic.id,
    childCount: 1,
    depth: 2,
  });
  expect(nodes.get(h.subtask.key)).toMatchObject({
    parentId: h.task.id,
    childCount: 0,
    depth: 3,
    link: `/tasks/${h.subtask.key}`,
  });
  // Every child names a parent that appears in the list, and every parent counts its children.
  const nodeList = listOf(result, "nodes");
  for (const node of nodeList) {
    const children = nodeList.filter((other) => other.parentId === node.id);
    expect(node.childCount).toBe(children.length);
    if (node.parentId !== null)
      expect(nodeList.some((other) => other.id === node.parentId)).toBe(true);
  }
});

it("reads the path and the subtree below one ticket, and needs no project for it", async () => {
  const harness = await setup();
  const h = await buildHierarchy(harness);
  const epic = await tree(harness, { ticketId: h.epic.key });
  expect(epic).toMatchObject({
    projectId: "p1",
    root: { id: h.epic.id, depth: 1, childCount: 1 },
    path: [{ id: h.initiative.id, depth: 0 }],
    total: 2,
  });
  expect(listOf(epic, "nodes").map((node) => [node.key, node.depth])).toEqual([
    [h.task.key, 2],
    [h.subtask.key, 3],
  ]);
  const leaf = await tree(harness, { ticketId: `/tasks/${h.subtask.key}` });
  expect(listOf(leaf, "path").map((node) => node.key)).toEqual([
    h.initiative.key,
    h.epic.key,
    h.task.key,
  ]);
  expect(leaf).toMatchObject({ nodes: [], total: 0 });
  const top = await tree(harness, {
    ticketId: h.initiative.id,
    projectId: "p1",
  });
  expect(top).toMatchObject({ path: [], total: 5 });
});

it("shows only visible tickets, ends the path at a hidden parent and gives hidden tickets no trace", async () => {
  const harness = await setup();
  const h = await buildHierarchy(harness);
  const hiddenChild = await createTicket(harness, {
    type: "task",
    title: "Secret child",
    parentId: h.epic.id,
    departmentId: "beta",
  });
  const hiddenEpic = await createTicket(harness, {
    type: "epic",
    title: "Secret epic",
    parentId: h.initiative.id,
    departmentId: "beta",
  });
  const orphan = await createTicket(harness, {
    type: "task",
    title: "Visible below hidden",
    parentId: hiddenEpic.id,
    departmentId: "alpha",
  });
  expect(await tree(harness, { projectId: "p1" })).toMatchObject({ total: 9 });

  actAs(harness, "writer");
  const project = await tree(harness, { projectId: "p1" });
  expect(project).toMatchObject({ total: 7 });
  const nodes = nodesByKey(project);
  expect(nodes.has(hiddenChild.key)).toBe(false);
  expect(nodes.has(hiddenEpic.key)).toBe(false);
  expect(nodes.get(h.epic.key)).toMatchObject({ childCount: 1 });
  expect(nodes.get(h.initiative.key)).toMatchObject({ childCount: 2 });
  expect(nodes.get(orphan.key)).toMatchObject({
    parentId: null,
    parentKey: null,
    depth: 0,
  });
  expect(JSON.stringify(project)).not.toContain("Secret");
  const below = await tree(harness, { ticketId: orphan.id });
  expect(below).toMatchObject({
    root: { id: orphan.id, parentId: null, depth: 0 },
    path: [],
  });
  const missing = await tree(harness, { ticketId: "no-such-ticket" });
  expect(missing).toMatchObject({ code: "NOT_FOUND" });
  expect(await tree(harness, { ticketId: hiddenChild.id })).toEqual(missing);
});

it("pages a tree without repeating or skipping a node and refuses ambiguous scopes", async () => {
  const harness = await setup();
  const h = await buildHierarchy(harness);
  const pages = await collectPages(
    harness,
    "read_ticket_tree",
    { projectId: "p1" },
    "nodes",
    2,
  );
  expect(pages.pages).toBe(3);
  expect(pages.entries.map((node) => node.key)).toEqual([
    h.initiative.key,
    h.epic.key,
    h.task.key,
    h.subtask.key,
    h.otherEpic.key,
    h.otherTask.key,
  ]);
  expect(await tree(harness, {})).toEqual({ code: "INVALID_REQUEST" });
  expect(await tree(harness, { projectId: "p2", ticketId: h.epic.id })).toEqual(
    { code: "INVALID_REQUEST" },
  );
  expect(await tree(harness, { projectId: "p1", limit: 0 })).toEqual({
    code: "INVALID_REQUEST",
  });
  expect(await tree(harness, { projectId: "p1", extra: 1 })).toEqual({
    code: "INVALID_REQUEST",
  });
  actAs(harness, "writer");
  expect(await tree(harness, { projectId: "p2" })).toMatchObject({
    code: "NOT_FOUND",
  });
});

it("attaches, moves and detaches a ticket and reads every step back", async () => {
  const harness = await setup();
  const h = await buildHierarchy(harness);
  const loose = await createTicket(harness, { type: "task", title: "Loose" });
  expect(await readTicket(harness, loose.id)).toMatchObject({ parentId: null });

  const attached = await setParent(harness, loose.id, null, h.epic.id);
  expect(attached).toMatchObject({
    ticketId: loose.id,
    key: loose.key,
    field: "parent",
    changed: true,
  });
  expect(await readTicket(harness, loose.id)).toMatchObject({
    parentId: h.epic.id,
    parentKey: h.epic.key,
  });
  expect(await tree(harness, { ticketId: h.epic.id })).toMatchObject({
    root: { childCount: 2 },
    total: 3,
  });

  const moved = await setParent(harness, loose.id, h.epic.id, h.otherEpic.key);
  expect(moved).toMatchObject({ changed: true });
  expect(await readTicket(harness, loose.id)).toMatchObject({
    parentId: h.otherEpic.id,
  });
  expect(await tree(harness, { ticketId: h.epic.id })).toMatchObject({
    root: { childCount: 1 },
  });
  expect(await tree(harness, { ticketId: h.otherEpic.id })).toMatchObject({
    root: { childCount: 2 },
  });

  const detached = await setParent(harness, loose.id, h.otherEpic.id, null);
  expect(detached).toMatchObject({ changed: true });
  expect(await readTicket(harness, loose.id)).toMatchObject({
    parentId: null,
    parentKey: null,
  });
  const unchanged = await setParent(harness, loose.id, null, null);
  expect(unchanged).toMatchObject({ changed: false });

  // An epic moves below another initiative together with everything below it.
  const second = await createTicket(harness, {
    type: "initiative",
    title: "Second initiative",
  });
  expect(
    await setParent(harness, h.epic.id, h.initiative.id, second.id),
  ).toMatchObject({ changed: true });
  expect(await tree(harness, { ticketId: second.id })).toMatchObject({
    total: 3,
  });
  expect(await readTicket(harness, h.subtask.id)).toMatchObject({
    parentId: h.task.id,
  });
});

it("changes only the parent: fields, links and assignment of the ticket stay as they are", async () => {
  const harness = await setup();
  const h = await buildHierarchy(harness);
  const other = await createTicket(harness, { type: "task", title: "Linked" });
  await callTool(harness, "add_ticket_link", {
    operationId: operationId(),
    ticketId: h.task.id,
    targetTicketId: other.id,
    linkType: "blocks",
  });
  const before = await readTicket(harness, h.task.id);
  const links = await callTool(harness, "read_ticket_links", {
    ticketId: h.task.id,
  });
  expect(
    await setParent(harness, h.task.id, h.epic.id, h.otherEpic.id),
  ).toMatchObject({ changed: true });
  const after = await readTicket(harness, h.task.id);
  const { parentId: oldParent, parentKey: oldKey, ...rest } = before;
  const { parentId: newParent, parentKey: newKey, ...restAfter } = after;
  expect([oldParent, oldKey]).toEqual([h.epic.id, h.epic.key]);
  expect([newParent, newKey]).toEqual([h.otherEpic.id, h.otherEpic.key]);
  expect(restAfter).toEqual(rest);
  expect(
    await callTool(harness, "read_ticket_links", { ticketId: h.task.id }),
  ).toEqual(links);
});

it("refuses a parent of the wrong type, of another project, the ticket itself and its own descendants", async () => {
  const harness = await setup();
  const h = await buildHierarchy(harness);
  const foreign = await callTool(harness, "create_ticket", {
    operationId: operationId(),
    projectId: "p2",
    type: "epic",
    title: "Foreign epic",
    description: "",
    statusId: null,
    parentId: null,
  });
  const foreignEpic = textOf(foreign, "ticketId");
  const refused: [string, string | null, string | null][] = [
    // wrong level: tasks below epics only
    [h.task.id, h.epic.id, h.initiative.id],
    // an initiative has no parent
    [h.initiative.id, null, h.epic.id],
    // epics below initiatives only
    [h.epic.id, h.initiative.id, h.task.id],
    // subtasks below tasks only
    [h.subtask.id, h.task.id, h.epic.id],
    // another project
    [h.task.id, h.epic.id, foreignEpic],
    // the ticket itself
    [h.epic.id, h.initiative.id, h.epic.id],
    [h.task.id, h.epic.id, h.task.id],
    // its own descendant, which would close a cycle
    [h.epic.id, h.initiative.id, h.subtask.id],
    [h.task.id, h.epic.id, h.subtask.id],
    // a subtask needs its parent
    [h.subtask.id, h.task.id, null],
  ];
  for (const [ticketId, expected, parentId] of refused)
    expect(
      await setParent(harness, ticketId, expected, parentId),
      `${ticketId} -> ${String(parentId)}`,
    ).toEqual({ code: "INVALID_REQUEST" });
  const nodes = nodesByKey(await tree(harness, { projectId: "p1" }));
  expect(nodes.get(h.task.key)).toMatchObject({ parentId: h.epic.id });
  expect(nodes.get(h.epic.key)).toMatchObject({ parentId: h.initiative.id });
  expect(nodes.get(h.subtask.key)).toMatchObject({ parentId: h.task.id });
  expect(nodes.get(h.initiative.key)).toMatchObject({ parentId: null });
});

it("treats a hidden parent like a missing one, protects against stale parents and refuses readers", async () => {
  const harness = await setup();
  const h = await buildHierarchy(harness);
  const hiddenEpic = await createTicket(harness, {
    type: "epic",
    title: "Secret epic",
    parentId: h.initiative.id,
    departmentId: "beta",
  });
  actAs(harness, "writer");
  const hidden = await setParent(harness, h.task.id, h.epic.id, hiddenEpic.id);
  const missing = await setParent(harness, h.task.id, h.epic.id, "no-such-id");
  expect(missing).toMatchObject({ code: "NOT_FOUND" });
  expect(hidden).toEqual(missing);
  expect(
    await setParent(harness, hiddenEpic.id, h.initiative.id, h.initiative.id),
  ).toEqual(
    await setParent(harness, "no-such-id", h.initiative.id, h.initiative.id),
  );

  // Stale: the ticket sits below another parent than the caller read.
  expect(
    await setParent(harness, h.task.id, h.otherEpic.id, h.otherEpic.id),
  ).toEqual({ code: "CONFLICT" });
  expect(await readTicket(harness, h.task.id)).toMatchObject({
    parentId: h.epic.id,
  });

  actAs(harness, "reader");
  expect(
    await setParent(harness, h.task.id, h.epic.id, h.otherEpic.id),
  ).toEqual({ code: "FORBIDDEN" });
  expect(await readTicket(harness, h.task.id)).toMatchObject({
    parentId: h.epic.id,
  });
});

it("recovers a lost response with the same operation ID and refuses changed input under it", async () => {
  const harness = await setup();
  const h = await buildHierarchy(harness);
  actAs(harness, "writer");
  const id = operationId("replay");
  const first = await setParent(
    harness,
    h.task.id,
    h.epic.id,
    h.otherEpic.id,
    id,
  );
  expect(first).toMatchObject({ changed: true });
  const activity = async (): Promise<number> =>
    Number(
      (
        await harness.database.query(
          "SELECT COUNT(*) FROM project_activity WHERE action = 'ticket.setParent';",
        )
      )[0]?.[0],
    );
  const count = await activity();
  expect(
    await setParent(harness, h.task.id, h.epic.id, h.otherEpic.id, id),
  ).toEqual(first);
  expect(await activity()).toBe(count);
  expect(await readTicket(harness, h.task.id)).toMatchObject({
    parentId: h.otherEpic.id,
  });
  expect(await setParent(harness, h.task.id, h.epic.id, h.epic.id, id)).toEqual(
    { code: "CONFLICT" },
  );
  expect(await readTicket(harness, h.task.id)).toMatchObject({
    parentId: h.otherEpic.id,
  });
  // The stored result is shown again only while the ticket is still visible.
  await harness.database.execute(
    "UPDATE work_items SET department_id = 'beta' WHERE id = $id;",
    { id: h.task.id },
  );
  expect(
    await setParent(harness, h.task.id, h.epic.id, h.otherEpic.id, id),
  ).toEqual(NOT_FOUND);
});
