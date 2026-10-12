import { expect, it } from "vitest";

import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";

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

const NOBODY = { targetType: "none", targetId: null } as const;

interface Assignment {
  readonly person?: string | null;
  readonly group?: string | null;
  readonly department?: string | null;
}

/** What a read of the ticket shows as its assignment, by identifier. */
async function assignmentOf(
  harness: TicketHarness,
  ticket: CreatedTicket,
): Promise<Required<Assignment>> {
  const read = await readTicket(harness, ticket.id);
  const idOf = (field: string): string | null => {
    const value = read[field];
    if (value === null) return null;
    if (typeof value === "object" && value !== null && "id" in value)
      return typeof value.id === "string" ? value.id : null;
    throw new Error(`Expected "${field}" in ${JSON.stringify(read)}`);
  };
  return {
    person: idOf("assignee"),
    group: idOf("assigneeGroup"),
    department: idOf("department"),
  };
}

function assign(
  harness: TicketHarness,
  ticket: CreatedTicket,
  parameters: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return callTool(harness, "set_ticket_assignee", {
    operationId: operationId("assign"),
    ticketId: ticket.id,
    expectedAssigneeId: null,
    expectedAssigneeGroupId: null,
    ...parameters,
  });
}

it("finds the target by name and assigns, switches and clears person, group and department with read-back", async () => {
  const harness = await setup();
  const ticket = await createTicket(harness, {
    type: "task",
    assignee: NOBODY,
  });
  expect(await assignmentOf(harness, ticket)).toEqual({
    person: null,
    group: null,
    department: null,
  });

  const found = await callTool(harness, "search_assignment_targets", {
    text: "Visible writer",
    targetType: "person",
    projectId: "p1",
  });
  expect(listOf(found, "targets")).toEqual([
    expect.objectContaining({ targetType: "person", id: "writer" }),
  ]);

  expect(
    await assign(harness, ticket, { targetType: "person", targetId: "writer" }),
  ).toMatchObject({ changed: true });
  expect(await assignmentOf(harness, ticket)).toEqual({
    person: "writer",
    group: null,
    department: null,
  });

  // Switching from a person to a group replaces the person and nothing else.
  expect(
    await assign(harness, ticket, {
      targetType: "group",
      targetId: "visible-group",
      expectedAssigneeId: "writer",
    }),
  ).toMatchObject({ changed: true });
  expect(await assignmentOf(harness, ticket)).toEqual({
    person: null,
    group: "visible-group",
    department: null,
  });

  // A department leaves the assignee alone.
  expect(
    await assign(harness, ticket, {
      targetType: "department",
      targetId: "alpha",
      expectedAssigneeGroupId: "visible-group",
      expectedDepartmentId: null,
    }),
  ).toMatchObject({ changed: true });
  expect(await assignmentOf(harness, ticket)).toEqual({
    person: null,
    group: "visible-group",
    department: "alpha",
  });

  // Clearing the assignee leaves the department alone, and the other way round.
  expect(
    await assign(harness, ticket, {
      ...NOBODY,
      expectedAssigneeGroupId: "visible-group",
    }),
  ).toMatchObject({ changed: true });
  expect(await assignmentOf(harness, ticket)).toEqual({
    person: null,
    group: null,
    department: "alpha",
  });
  expect(
    await assign(harness, ticket, {
      targetType: "department",
      targetId: null,
      expectedDepartmentId: "alpha",
    }),
  ).toMatchObject({ changed: true });
  expect(await assignmentOf(harness, ticket)).toEqual({
    person: null,
    group: null,
    department: null,
  });
});

it("changes only the assignment: the parent, the milestone and the title stay", async () => {
  const harness = await setup();
  const epic = await createTicket(harness, { type: "epic" });
  const ticket = await createTicket(harness, {
    type: "task",
    title: "Keep me",
    parentId: epic.id,
    assignee: NOBODY,
  });
  const before = await readTicket(harness, ticket.id);
  expect(
    await assign(harness, ticket, { targetType: "person", targetId: "writer" }),
  ).toMatchObject({ changed: true });
  expect(await readTicket(harness, ticket.id)).toEqual({
    ...before,
    assignee: expect.objectContaining({ id: "writer" }),
  });
});

it("refuses stale expected values with CONFLICT and writes nothing", async () => {
  const harness = await setup();
  const ticket = await createTicket(harness, {
    type: "task",
    assignee: { targetType: "person", targetId: "writer" },
    departmentId: "alpha",
  });
  expect(await assignmentOf(harness, ticket)).toEqual({
    person: "writer",
    group: null,
    department: "alpha",
  });
  const stale: Record<string, unknown>[] = [
    // read as unassigned, but the ticket belongs to the writer
    { targetType: "person", targetId: "manager" },
    { targetType: "group", targetId: "visible-group" },
    { ...NOBODY },
    // read another person
    {
      targetType: "person",
      targetId: "manager",
      expectedAssigneeId: "manager",
    },
    // read a group that is not set
    {
      targetType: "person",
      targetId: "manager",
      expectedAssigneeId: "writer",
      expectedAssigneeGroupId: "visible-group",
    },
    // read another department
    {
      targetType: "department",
      targetId: null,
      expectedDepartmentId: "beta",
    },
    { targetType: "department", targetId: "beta", expectedDepartmentId: null },
  ];
  for (const parameters of stale)
    expect(
      await assign(harness, ticket, parameters),
      JSON.stringify(parameters),
    ).toEqual({ code: "CONFLICT" });
  expect(await assignmentOf(harness, ticket)).toEqual({
    person: "writer",
    group: null,
    department: "alpha",
  });
  // The last value read is accepted; an assignee that already is the target changes nothing.
  expect(
    await assign(harness, ticket, {
      targetType: "person",
      targetId: "manager",
      expectedAssigneeId: "writer",
    }),
  ).toMatchObject({ changed: true });
  expect(await assignmentOf(harness, ticket)).toMatchObject({
    person: "manager",
  });
});

it("answers a hidden and a missing target alike and refuses accounts without the write right", async () => {
  const harness = await setup();
  const ticket = await createTicket(harness, {
    type: "task",
    assignee: NOBODY,
  });
  actAs(harness, "writer");
  const targets: [string, string, string][] = [
    ["person", "hidden", "no-such-person"],
    ["group", "hidden-group", "no-such-group"],
  ];
  for (const [targetType, hidden, missing] of targets) {
    const hiddenResult = await assign(harness, ticket, {
      targetType,
      targetId: hidden,
    });
    expect(hiddenResult, targetType).toEqual(NOT_FOUND);
    expect(
      await assign(harness, ticket, { targetType, targetId: missing }),
      targetType,
    ).toEqual(hiddenResult);
  }
  const hiddenDepartment = await assign(harness, ticket, {
    targetType: "department",
    targetId: "beta",
    expectedDepartmentId: null,
  });
  expect(hiddenDepartment).toEqual(NOT_FOUND);
  expect(
    await assign(harness, ticket, {
      targetType: "department",
      targetId: "no-such-department",
      expectedDepartmentId: null,
    }),
  ).toEqual(hiddenDepartment);
  expect(await assignmentOf(harness, ticket)).toEqual({
    person: null,
    group: null,
    department: null,
  });

  actAs(harness, "reader");
  expect(
    await assign(harness, ticket, { targetType: "person", targetId: "writer" }),
  ).toEqual({ code: "FORBIDDEN" });
  expect(
    await callTool(harness, "create_ticket", {
      operationId: operationId(),
      projectId: "p1",
      type: "task",
      title: "Not allowed",
      description: "",
      statusId: null,
      parentId: null,
    }),
  ).toEqual({ code: "FORBIDDEN" });
  expect(await assignmentOf(harness, ticket)).toEqual({
    person: null,
    group: null,
    department: null,
  });
});

it("assigns every new ticket to the signed-in person, not to the last one who created", async () => {
  const harness = await setup();
  const created: [string, CreatedTicket][] = [];
  for (const userId of ["writer", "manager", "writer", "manager", "writer"]) {
    actAs(harness, userId);
    created.push([userId, await createTicket(harness, { type: "task" })]);
  }
  actAs(harness, "owner");
  for (const [userId, ticket] of created)
    expect(await assignmentOf(harness, ticket), ticket.key).toEqual({
      person: userId,
      group: null,
      department: null,
    });

  // A ticket below a parent follows the same rule, and an explicit choice wins.
  actAs(harness, "manager");
  const epic = await createTicket(harness, { type: "epic" });
  const child = await createTicket(harness, {
    type: "task",
    parentId: epic.id,
  });
  const chosen = await createTicket(harness, {
    type: "task",
    parentId: epic.id,
    assignee: { targetType: "person", targetId: "writer" },
  });
  const grouped = await createTicket(harness, {
    type: "task",
    parentId: epic.id,
    assignee: { targetType: "group", targetId: "visible-group" },
  });
  const unassigned = await createTicket(harness, {
    type: "task",
    parentId: epic.id,
    assignee: NOBODY,
  });
  expect(await assignmentOf(harness, epic)).toMatchObject({
    person: "manager",
  });
  expect(await assignmentOf(harness, child)).toMatchObject({
    person: "manager",
  });
  expect(await assignmentOf(harness, chosen)).toMatchObject({
    person: "writer",
  });
  expect(await assignmentOf(harness, grouped)).toEqual({
    person: null,
    group: "visible-group",
    department: null,
  });
  expect(await assignmentOf(harness, unassigned)).toEqual({
    person: null,
    group: null,
    department: null,
  });
});

it("refuses a person the project does not allow and names no hidden person", async () => {
  const harness = await setup();
  // The administrator may be assigned in every project, so the default is that account.
  const byAdministrator = await createTicket(harness, { type: "task" });
  expect(await assignmentOf(harness, byAdministrator)).toMatchObject({
    person: "owner",
  });

  // A visible person of another department has no access to the project.
  const refusedIneligible = await callTool(harness, "create_ticket", {
    operationId: operationId(),
    projectId: "p1",
    type: "task",
    title: "Wrong person",
    description: "",
    statusId: null,
    parentId: null,
    assignee: { targetType: "person", targetId: "hidden" },
  });
  expect(refusedIneligible).toEqual({ code: "INVALID_REQUEST" });

  actAs(harness, "writer");
  const hiddenPerson = await callTool(harness, "create_ticket", {
    operationId: operationId(),
    projectId: "p1",
    type: "task",
    title: "Hidden person",
    description: "",
    statusId: null,
    parentId: null,
    assignee: { targetType: "person", targetId: "hidden" },
  });
  const missingPerson = await callTool(harness, "create_ticket", {
    operationId: operationId(),
    projectId: "p1",
    type: "task",
    title: "Missing person",
    description: "",
    statusId: null,
    parentId: null,
    assignee: { targetType: "person", targetId: "no-such-person" },
  });
  expect(hiddenPerson).toEqual(NOT_FOUND);
  expect(missingPerson).toEqual(hiddenPerson);
  const all = await collectPages(
    harness,
    "search_tickets",
    { projectId: "p1" },
    "tickets",
    10,
  );
  // Both refused calls created nothing.
  expect(all.entries.map((ticket) => ticket.key)).toEqual([
    byAdministrator.key,
  ]);
});

it("creates one ticket for one operation ID and keeps its assignee when another person repeats the call", async () => {
  const harness = await setup();
  actAs(harness, "writer");
  const id = operationId("create-once");
  const request = {
    operationId: id,
    projectId: "p1",
    type: "task",
    title: "Once",
    description: "",
    statusId: null,
    parentId: null,
  };
  const first = await callTool(harness, "create_ticket", request);
  expect(await callTool(harness, "create_ticket", request)).toEqual(first);
  const ticket = {
    id: textOf(first, "ticketId"),
    key: textOf(first, "key"),
  };
  expect(await assignmentOf(harness, ticket)).toMatchObject({
    person: "writer",
  });
  const count = await collectPages(
    harness,
    "search_tickets",
    { projectId: "p1", text: "Once" },
    "tickets",
    10,
  );
  expect(count.entries).toHaveLength(1);

  // The same ID from another person is another operation: nobody else's ticket is returned.
  actAs(harness, "manager");
  const other = await callTool(harness, "create_ticket", request);
  expect(textOf(other, "ticketId")).not.toBe(ticket.id);
  expect(
    await assignmentOf(harness, {
      id: textOf(other, "ticketId"),
      key: textOf(other, "key"),
    }),
  ).toMatchObject({ person: "manager" });
});

it("refuses a department that the account sees through a colleague but may not select", async () => {
  const harness = await setup();
  // The reader also belongs to beta, so everybody who sees the reader sees beta.
  const authorization = new AuthorizationRepository(harness.database);
  const access = (await authorization.snapshot()).accounts.find(
    ({ userId }) => userId === "reader",
  );
  if (!access) throw new Error("Missing reader account.");
  await authorization.saveAccount({
    ...access,
    departments: [...access.departments, "beta"],
  });
  const ticket = await createTicket(harness, {
    type: "task",
    assignee: NOBODY,
  });

  actAs(harness, "writer");
  const targets = await callTool(harness, "search_assignment_targets", {
    targetType: "department",
  });
  // It is a visible department, but not one the writer may put a ticket into.
  expect(
    listOf(targets, "targets").map((target) => textOf(target, "id")),
  ).toEqual(["alpha"]);
  expect(
    await assign(harness, ticket, {
      targetType: "department",
      targetId: "beta",
      expectedDepartmentId: null,
    }),
  ).toEqual({ code: "FORBIDDEN" });
  expect(
    await callTool(harness, "create_ticket", {
      operationId: operationId(),
      projectId: "p1",
      type: "task",
      title: "Beta",
      description: "",
      statusId: null,
      parentId: null,
      departmentId: "beta",
    }),
  ).toEqual({ code: "FORBIDDEN" });
  expect(await assignmentOf(harness, ticket)).toMatchObject({
    department: null,
  });
});
