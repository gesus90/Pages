import { expect, it, vi } from "vitest";

import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";

import { a11Fetch, callA11Tool, useA11McpHarness } from "../helpers/a11-mcp";

const setup = useA11McpHarness();

it("can reassign a visible ticket after the previous assignee loses directory visibility", async () => {
  const harness = await setup();
  vi.stubGlobal("fetch", a11Fetch(harness));
  const authorization = new AuthorizationRepository(harness.database);
  const account = (await authorization.snapshot()).accounts.find(
    ({ userId }) => userId === "hidden",
  );
  if (!account) throw new Error("Missing assignee account");
  await authorization.saveAccount({ ...account, departments: ["alpha"] });
  const ticket = await callA11Tool(harness.connection, "create_ticket", {
    operationId: "ticket",
    projectId: "p1",
    type: "task",
    title: "Ticket",
    description: "",
    parentId: null,
    statusId: null,
    milestoneId: null,
  });
  const assignment = {
    operationId: "first-assignment",
    ticketId: ticket.ticketId,
    targetType: "person",
    targetId: "hidden",
    expectedAssigneeId: null,
    expectedAssigneeGroupId: null,
  };
  expect(
    await callA11Tool(harness.connection, "set_ticket_assignee", assignment),
  ).toMatchObject({ changed: true });
  await authorization.saveAccount(account);
  harness.configuration.token = harness.tokens.get("writer") ?? "";
  const visible = await callA11Tool(harness.connection, "read_ticket", {
    ticketId: ticket.ticketId,
  });
  expect(visible).toMatchObject({ assignee: null });
  expect(JSON.stringify(visible)).not.toContain("Hidden name");
  expect(
    await callA11Tool(harness.connection, "set_ticket_assignee", {
      ...assignment,
      operationId: "new-assignment",
      targetId: "writer",
    }),
  ).toMatchObject({ changed: true });
  expect(
    await callA11Tool(harness.connection, "read_ticket", {
      ticketId: ticket.ticketId,
    }),
  ).toMatchObject({ assignee: { id: "writer" } });
});

it("assigns a ticket to a visible person or group and milestone, enforces conflicts and refuses readers", async () => {
  const harness = await setup();
  vi.stubGlobal("fetch", a11Fetch(harness));
  const ticket = await callA11Tool(harness.connection, "create_ticket", {
    operationId: "ticket",
    projectId: "p1",
    type: "task",
    title: "Ticket",
    description: "Description",
    parentId: null,
    statusId: null,
    milestoneId: null,
  });
  const milestone = await callA11Tool(harness.connection, "create_milestone", {
    operationId: "milestone",
    projectId: "p1",
    name: "Milestone",
    description: "Description",
    startAt: null,
    dueAt: null,
  });
  const assignee = {
    operationId: "assign",
    ticketId: ticket.ticketId,
    targetType: "person",
    targetId: "writer",
    expectedAssigneeId: null,
    expectedAssigneeGroupId: null,
  };
  expect(
    await callA11Tool(harness.connection, "set_ticket_assignee", assignee),
  ).toMatchObject({ changed: true });
  expect(
    await callA11Tool(harness.connection, "set_ticket_assignee", {
      ...assignee,
      operationId: "stale",
    }),
  ).toMatchObject({ code: "CONFLICT" });
  expect(
    await callA11Tool(harness.connection, "set_ticket_assignee", {
      ...assignee,
      operationId: "group",
      expectedAssigneeId: "writer",
      targetType: "group",
      targetId: "visible-group",
    }),
  ).toMatchObject({ changed: true });
  harness.configuration.token = harness.tokens.get("writer") ?? "";
  const department = {
    ...assignee,
    operationId: "department",
    expectedAssigneeId: null,
    expectedAssigneeGroupId: "visible-group",
    targetType: "department",
    targetId: "alpha",
    expectedDepartmentId: null,
  };
  expect(
    await callA11Tool(harness.connection, "set_ticket_assignee", department),
  ).toMatchObject({ changed: true });
  expect(
    await callA11Tool(harness.connection, "set_ticket_assignee", {
      ...department,
      operationId: "outside-department",
      targetId: "beta",
      expectedDepartmentId: "alpha",
    }),
  ).toMatchObject({ code: "NOT_FOUND" });
  expect(
    await callA11Tool(harness.connection, "set_ticket_assignee", {
      ...department,
      operationId: "stale-department",
    }),
  ).toMatchObject({ code: "CONFLICT" });
  expect(
    await callA11Tool(harness.connection, "set_ticket_assignee", {
      ...department,
      operationId: "hidden-person",
      targetType: "person",
      targetId: "hidden",
    }),
  ).toMatchObject({ code: "NOT_FOUND" });
  harness.configuration.token = harness.tokens.get("owner") ?? "";
  const assignMilestone = {
    operationId: "assign-milestone",
    ticketId: ticket.ticketId,
    milestoneId: milestone.milestoneId,
    expectedMilestoneId: null,
  };
  expect(
    await callA11Tool(
      harness.connection,
      "assign_ticket_to_milestone",
      assignMilestone,
    ),
  ).toMatchObject({ changed: true });
  expect(
    await callA11Tool(harness.connection, "assign_ticket_to_milestone", {
      ...assignMilestone,
      operationId: "stale-milestone",
    }),
  ).toMatchObject({ code: "CONFLICT" });
  harness.configuration.token = harness.tokens.get("reader") ?? "";
  expect(
    await callA11Tool(harness.connection, "set_ticket_assignee", {
      ...assignee,
      operationId: "reader",
    }),
  ).toMatchObject({ code: "FORBIDDEN" });
  expect(
    await callA11Tool(harness.connection, "assign_ticket_to_milestone", {
      ...assignMilestone,
      operationId: "reader-milestone",
    }),
  ).toMatchObject({ code: "FORBIDDEN" });
  expect(
    await callA11Tool(harness.connection, "read_ticket", {
      ticketId: ticket.ticketId,
    }),
  ).toMatchObject({
    assigneeGroup: { id: "visible-group", name: "Visible group" },
    department: { id: "alpha" },
    milestoneId: milestone.milestoneId,
  });
  expect(
    await callA11Tool(harness.connection, "list_project_tickets", {
      projectId: "p1",
      limit: 1,
    }),
  ).toMatchObject({
    total: 1,
    tickets: [expect.objectContaining({ id: ticket.ticketId })],
  });
  expect(
    await callA11Tool(harness.connection, "read_project_activity", {
      projectId: "p1",
    }),
  ).toMatchObject({
    entries: expect.arrayContaining([
      expect.objectContaining({
        source: "mcp",
        action: "ticket.assignMilestone",
      }),
    ]),
  });
});

it("archives tickets and milestones only with confirmation and the UI rights", async () => {
  const harness = await setup();
  vi.stubGlobal("fetch", a11Fetch(harness));
  const ticket = await callA11Tool(harness.connection, "create_ticket", {
    operationId: "ticket",
    projectId: "p1",
    type: "task",
    title: "Ticket",
    description: "",
    parentId: null,
    statusId: null,
    milestoneId: null,
  });
  const milestone = await callA11Tool(harness.connection, "create_milestone", {
    operationId: "milestone",
    projectId: "p1",
    name: "Milestone",
    description: "",
    startAt: null,
    dueAt: null,
  });
  const ticketInput = {
    operationId: "delete-ticket",
    ticketId: ticket.ticketId,
  };
  const milestoneInput = {
    operationId: "delete-milestone",
    projectId: "p1",
    milestoneId: milestone.milestoneId,
  };
  expect(
    await callA11Tool(harness.connection, "delete_ticket", ticketInput),
  ).toMatchObject({ code: "CONFIRMATION_REQUIRED" });
  expect(
    await callA11Tool(harness.connection, "delete_milestone", milestoneInput),
  ).toMatchObject({ code: "CONFIRMATION_REQUIRED" });
  harness.configuration.token = harness.tokens.get("reader") ?? "";
  expect(
    await callA11Tool(harness.connection, "delete_ticket", {
      ...ticketInput,
      confirmation: "LÖSCHEN",
    }),
  ).toMatchObject({ code: "FORBIDDEN" });
  expect(
    await callA11Tool(harness.connection, "delete_milestone", {
      ...milestoneInput,
      confirmation: "LÖSCHEN",
    }),
  ).toMatchObject({ code: "FORBIDDEN" });
  harness.configuration.token = harness.tokens.get("owner") ?? "";
  expect(
    await callA11Tool(harness.connection, "delete_ticket", {
      ...ticketInput,
      confirmation: "LÖSCHEN",
    }),
  ).toMatchObject({ recursive: true, disposition: "trash", affectedCount: 1 });
  expect(
    await callA11Tool(harness.connection, "delete_milestone", {
      ...milestoneInput,
      confirmation: "LÖSCHEN",
    }),
  ).toMatchObject({ disposition: "trash" });
  expect(
    await callA11Tool(harness.connection, "read_ticket", {
      ticketId: ticket.ticketId,
    }),
  ).toMatchObject({ isArchived: true });
  expect(
    await callA11Tool(harness.connection, "read_milestones", {
      projectId: "p1",
    }),
  ).toMatchObject({ milestones: [], dependencies: [], total: 0 });
});
