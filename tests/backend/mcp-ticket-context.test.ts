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

/** Creates a ticket without a project: everything the call leaves out comes from the parent. */
function createBelow(
  harness: TicketHarness,
  parent: CreatedTicket,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return callTool(harness, "create_ticket", {
    operationId: operationId("below"),
    title: "Child",
    description: "",
    statusId: null,
    parentId: parent.id,
    ...fields,
  });
}

async function createMilestone(
  harness: TicketHarness,
  projectId: string,
  name: string,
): Promise<string> {
  return textOf(
    await callTool(harness, "create_milestone", {
      operationId: operationId("milestone"),
      projectId,
      name,
      description: "",
      startAt: null,
      dueAt: null,
    }),
    "milestoneId",
  );
}

function asTicket(result: Record<string, unknown>): CreatedTicket {
  return { id: textOf(result, "ticketId"), key: textOf(result, "key") };
}

function departmentIdOf(ticket: Record<string, unknown>): string | null {
  const { department } = ticket;
  if (typeof department === "object" && department !== null)
    return "id" in department && typeof department.id === "string"
      ? department.id
      : null;
  return null;
}

async function countTickets(
  harness: TicketHarness,
  projectId: string,
): Promise<number> {
  const { entries } = await collectPages(
    harness,
    "search_tickets",
    { projectId },
    "tickets",
    100,
  );
  return entries.length;
}

it("takes the project of the parent when the call names none and refuses a project that disagrees", async () => {
  const harness = await setup();
  const foreignEpic = await createTicket(harness, {
    type: "epic",
    projectId: "p2",
    title: "Beta epic",
  });
  expect(foreignEpic.key).toMatch(/^BS-/);

  const taken = asTicket(
    await createBelow(harness, foreignEpic, { type: "task" }),
  );
  expect(taken.key).toMatch(/^BS-/);
  expect(await readTicket(harness, taken.id)).toMatchObject({
    projectId: "p2",
    parentId: foreignEpic.id,
  });
  const nulled = asTicket(
    await createBelow(harness, foreignEpic, { type: "task", projectId: null }),
  );
  expect(await readTicket(harness, nulled.id)).toMatchObject({
    projectId: "p2",
  });
  const stated = asTicket(
    await createBelow(harness, foreignEpic, { type: "task", projectId: "p2" }),
  );
  expect(await readTicket(harness, stated.id)).toMatchObject({
    projectId: "p2",
  });
  expect(await countTickets(harness, "p2")).toBe(4);

  // Another project than the parent's is refused, and nothing is created.
  expect(
    await createBelow(harness, foreignEpic, { type: "task", projectId: "p1" }),
  ).toEqual({ code: "INVALID_REQUEST" });
  expect(await countTickets(harness, "p1")).toBe(0);
  expect(await countTickets(harness, "p2")).toBe(4);

  // Without a parent the project must be named.
  expect(
    await callTool(harness, "create_ticket", {
      operationId: operationId(),
      type: "task",
      title: "Nowhere",
      description: "",
      statusId: null,
      parentId: null,
    }),
  ).toEqual({ code: "INVALID_REQUEST" });
  expect(
    await callTool(harness, "create_ticket", {
      operationId: operationId(),
      projectId: null,
      type: "task",
      title: "Nowhere",
      description: "",
      statusId: null,
      parentId: null,
    }),
  ).toEqual({ code: "INVALID_REQUEST" });
});

it("takes the milestone and the department of the parent, lets stated values win and invents nothing", async () => {
  const harness = await setup();
  const first = await createMilestone(harness, "p1", "First");
  const second = await createMilestone(harness, "p1", "Second");
  const initiative = await createTicket(harness, { type: "initiative" });
  const epic = await createTicket(harness, {
    type: "epic",
    parentId: initiative.id,
    milestoneId: first,
    departmentId: "alpha",
  });

  const task = asTicket(await createBelow(harness, epic, { type: "task" }));
  expect(await readTicket(harness, task.id)).toMatchObject({
    projectId: "p1",
    milestoneId: first,
    department: { id: "alpha" },
  });
  // The subtask follows the task, one level further down.
  const subtask = asTicket(
    await createBelow(harness, task, { type: "subtask" }),
  );
  expect(await readTicket(harness, subtask.id)).toMatchObject({
    milestoneId: first,
    department: { id: "alpha" },
  });

  // What the call states wins, and the epic keeps what it carries.
  const stated = asTicket(
    await createBelow(harness, epic, {
      type: "task",
      milestoneId: second,
      departmentId: "beta",
    }),
  );
  expect(await readTicket(harness, stated.id)).toMatchObject({
    milestoneId: second,
    department: { id: "beta" },
  });
  expect(await readTicket(harness, epic.id)).toMatchObject({
    milestoneId: first,
    department: { id: "alpha" },
  });

  // A parent without values gives nothing: no milestone and no department appear.
  const bare = await createTicket(harness, {
    type: "epic",
    parentId: initiative.id,
  });
  const child = asTicket(await createBelow(harness, bare, { type: "task" }));
  const read = await readTicket(harness, child.id);
  expect(read).toMatchObject({ milestoneId: null, milestoneName: null });
  expect(departmentIdOf(read)).toBeNull();

  // A milestone of another project is refused like a missing one; nothing is created.
  const foreignMilestone = await createMilestone(harness, "p2", "Foreign");
  const before = await countTickets(harness, "p1");
  expect(
    await createBelow(harness, epic, {
      type: "task",
      milestoneId: foreignMilestone,
    }),
  ).toEqual(NOT_FOUND);
  expect(
    await createBelow(harness, epic, {
      type: "task",
      milestoneId: "no-such-milestone",
    }),
  ).toEqual(NOT_FOUND);
  expect(await countTickets(harness, "p1")).toBe(before);
});

it("gives the milestone of a new task to its epic and links its initiative, without overwriting", async () => {
  const harness = await setup();
  const first = await createMilestone(harness, "p1", "First");
  const second = await createMilestone(harness, "p1", "Second");
  const initiative = await createTicket(harness, { type: "initiative" });
  const free = await createTicket(harness, {
    type: "epic",
    parentId: initiative.id,
  });
  const taken = await createTicket(harness, {
    type: "epic",
    parentId: initiative.id,
    milestoneId: second,
  });
  expect(await readTicket(harness, free.id)).toMatchObject({
    milestoneId: null,
  });

  // The free epic takes the milestone of its task; the initiative is linked with it.
  const task = asTicket(
    await createBelow(harness, free, { type: "task", milestoneId: first }),
  );
  expect(await readTicket(harness, task.id)).toMatchObject({
    milestoneId: first,
  });
  expect(await readTicket(harness, free.id)).toMatchObject({
    milestoneId: first,
  });
  const linked = async (): Promise<string[]> =>
    listOf(await readTicket(harness, initiative.id), "linkedMilestones")
      .map((milestone) => textOf(milestone, "id"))
      .sort();
  // Only a task starts the thread: the epic created with a milestone linked nothing.
  expect(await linked()).toEqual([first]);

  // A task below the epic that carries a milestone takes it, and links the initiative.
  const inherited = asTicket(
    await createBelow(harness, taken, { type: "task" }),
  );
  expect(await readTicket(harness, inherited.id)).toMatchObject({
    milestoneId: second,
  });
  expect(await linked()).toEqual([first, second].sort());

  // A task of another milestone leaves the epic as it is.
  const other = asTicket(
    await createBelow(harness, taken, { type: "task", milestoneId: first }),
  );
  expect(await readTicket(harness, other.id)).toMatchObject({
    milestoneId: first,
  });
  expect(await readTicket(harness, taken.id)).toMatchObject({
    milestoneId: second,
  });
  expect(await linked()).toEqual([first, second].sort());

  // Read from the milestone: the initiative is listed with it.
  const milestones = listOf(
    await callTool(harness, "read_milestones", { projectId: "p1" }),
    "milestones",
  );
  const byId = new Map(
    milestones.map((milestone) => [textOf(milestone, "id"), milestone]),
  );
  expect(
    listOf(byId.get(first) ?? {}, "initiatives").map((entry) =>
      textOf(entry, "id"),
    ),
  ).toEqual([initiative.id]);
});

it("reads the context from a parent the account sees and treats a hidden parent like a missing one", async () => {
  const harness = await setup();
  const milestone = await createMilestone(harness, "p1", "Release");
  const epic = await createTicket(harness, {
    type: "epic",
    milestoneId: milestone,
    departmentId: "alpha",
  });
  const secret = await createTicket(harness, {
    type: "epic",
    departmentId: "beta",
  });

  actAs(harness, "writer");
  const child = asTicket(await createBelow(harness, epic, { type: "task" }));
  expect(await readTicket(harness, child.id)).toMatchObject({
    milestoneId: milestone,
    department: { id: "alpha" },
    assignee: { id: "writer" },
  });

  const before = await countTickets(harness, "p1");
  const hidden = await createBelow(harness, secret, { type: "task" });
  const missing = await callTool(harness, "create_ticket", {
    operationId: operationId(),
    type: "task",
    title: "Child",
    description: "",
    statusId: null,
    parentId: "no-such-ticket",
  });
  expect(hidden).toEqual(NOT_FOUND);
  expect(missing).toEqual(NOT_FOUND);
  expect(await countTickets(harness, "p1")).toBe(before);
});
