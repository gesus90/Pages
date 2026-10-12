import { expect, it } from "vitest";

import {
  actAs,
  callTool,
  collectPages,
  createTicket,
  listOf,
  NOT_FOUND,
  operationId,
  textOf,
  useTicketHarness,
} from "../helpers/mcp-tickets";

import type { TicketHarness } from "../helpers/mcp-tickets";

const setup = useTicketHarness();

async function search(
  harness: TicketHarness,
  parameters: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return callTool(harness, "search_tickets", {
    projectId: "p1",
    ...parameters,
  });
}

function keysOf(result: Record<string, unknown>): string[] {
  return listOf(result, "tickets").map((ticket) => textOf(ticket, "key"));
}

it("offers the search, tree, link and target tools with documented schemas and read-only annotations", async () => {
  const harness = await setup();
  const listed = await harness.connection.request("tools/list");
  const tools = (
    listed?.result as { tools: { name: string; [key: string]: unknown }[] }
  ).tools;
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  for (const name of [
    "search_tickets",
    "read_ticket_tree",
    "read_ticket_links",
    "search_assignment_targets",
    "add_ticket_link",
    "remove_ticket_link",
    "create_ticket",
    "set_ticket_parent",
    "set_ticket_assignee",
  ])
    expect(byName.has(name), name).toBe(true);
  expect(byName.get("search_tickets")).toMatchObject({
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["projectId"],
      properties: {
        projectId: { type: "string", minLength: 1, maxLength: 200 },
        text: { type: "string", minLength: 1, maxLength: 200 },
        type: { enum: ["initiative", "epic", "task", "subtask"] },
        tagIds: { type: "array", maxItems: 50, uniqueItems: true },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  });
  expect(byName.get("add_ticket_link")).toMatchObject({
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      required: ["operationId", "ticketId", "targetTicketId", "linkType"],
      properties: {
        linkType: { enum: ["blocks", "relates_to", "duplicates"] },
      },
    },
  });
  expect(byName.get("remove_ticket_link")).toMatchObject({
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: { required: ["operationId", "ticketId", "linkId"] },
  });
  expect(byName.get("create_ticket")).toMatchObject({
    inputSchema: {
      required: [
        "operationId",
        "type",
        "title",
        "description",
        "statusId",
        "parentId",
      ],
    },
  });
  for (const name of [
    "search_tickets",
    "read_ticket_tree",
    "read_ticket_links",
    "search_assignment_targets",
    "add_ticket_link",
    "remove_ticket_link",
  ])
    expect(String(byName.get(name)?.description)).toMatch(/NOT_FOUND|CONFLICT/);
});

it("finds tickets by key, title and description without regard to case and shows where the description matched", async () => {
  const harness = await setup();
  const payment = await createTicket(harness, {
    type: "task",
    title: "Payment flow",
    description: "Handles invoices",
  });
  const gateway = await createTicket(harness, {
    type: "task",
    title: "Gateway",
    description:
      "The checkout talks to the PAYMENT gateway before it confirms the order.",
  });
  await createTicket(harness, {
    type: "task",
    title: "Unrelated",
    description: "Something else",
  });
  const found = await search(harness, { text: "payment" });
  expect(keysOf(found).sort()).toEqual([payment.key, gateway.key].sort());
  expect(found).toMatchObject({ total: 2, nextCursor: null, projectId: "p1" });
  const hits = new Map(
    listOf(found, "tickets").map((ticket) => [ticket.key, ticket]),
  );
  expect(hits.get(payment.key)).toMatchObject({ snippet: null });
  expect(String(hits.get(gateway.key)?.snippet)).toContain("PAYMENT gateway");
  expect(JSON.stringify(found)).not.toContain("Handles invoices");
  expect(
    keysOf(await search(harness, { text: payment.key.toLowerCase() })),
  ).toEqual([payment.key]);
  expect(keysOf(await search(harness, { text: "  PAYMENT FLOW " }))).toEqual([
    payment.key,
  ]);
});

it("takes percent and underscore of the text literally", async () => {
  const harness = await setup();
  const literal = await createTicket(harness, {
    type: "task",
    description: "Reached 100% of the goal and the_end",
  });
  await createTicket(harness, {
    type: "task",
    title: "Other",
    description: "Reached 100 of the goal and theXend",
  });
  expect(keysOf(await search(harness, { text: "100%" }))).toEqual([
    literal.key,
  ]);
  expect(keysOf(await search(harness, { text: "the_end" }))).toEqual([
    literal.key,
  ]);
  expect(keysOf(await search(harness, { text: "%" }))).toEqual([literal.key]);
});

it("filters by type, status, parent, milestone, department, person, group and tag, and combines the filters", async () => {
  const harness = await setup();
  const initiative = await createTicket(harness, { type: "initiative" });
  const epic = await createTicket(harness, {
    type: "epic",
    parentId: initiative.id,
  });
  const milestone = await callTool(harness, "create_milestone", {
    operationId: operationId(),
    projectId: "p1",
    name: "Release",
    description: "",
    startAt: null,
    dueAt: null,
  });
  const milestoneId = textOf(milestone, "milestoneId");
  const task = await createTicket(harness, {
    type: "task",
    parentId: epic.id,
    milestoneId,
    departmentId: "alpha",
    assignee: { targetType: "person", targetId: "writer" },
  });
  const grouped = await createTicket(harness, {
    type: "task",
    parentId: epic.id,
    assignee: { targetType: "group", targetId: "visible-group" },
  });
  const plain = await createTicket(harness, {
    type: "task",
    assignee: { targetType: "none", targetId: null },
  });
  await harness.database.execute(
    "INSERT INTO labels (id, name) VALUES ('tag-1', 'Backend'), ('tag-2', 'Docs');",
  );
  expect(
    await callTool(harness, "set_ticket_tags", {
      operationId: operationId(),
      ticketId: task.id,
      tagIds: ["tag-1"],
      expectedTagIds: [],
    }),
  ).toMatchObject({ changed: true });

  const all = await search(harness, {});
  expect(all).toMatchObject({ total: 5 });
  expect(keysOf(await search(harness, { type: "task" })).sort()).toEqual(
    [task.key, grouped.key, plain.key].sort(),
  );
  expect(keysOf(await search(harness, { type: "epic" }))).toEqual([epic.key]);
  expect(keysOf(await search(harness, { parentId: epic.key })).sort()).toEqual(
    [task.key, grouped.key].sort(),
  );
  expect(
    keysOf(await search(harness, { parentId: `/tasks/${initiative.key}` })),
  ).toEqual([epic.key]);
  // The task gives its milestone to the epic, and the second task takes the
  // milestone of that epic; the initiative is linked, not assigned.
  expect(keysOf(await search(harness, { milestoneId })).sort()).toEqual(
    [epic.key, task.key, grouped.key].sort(),
  );
  expect(keysOf(await search(harness, { departmentId: "alpha" }))).toEqual([
    task.key,
  ]);
  expect(keysOf(await search(harness, { assigneeId: "writer" }))).toEqual([
    task.key,
  ]);
  expect(
    keysOf(await search(harness, { assigneeGroupId: "visible-group" })),
  ).toEqual([grouped.key]);
  expect(keysOf(await search(harness, { tagIds: ["tag-1", "tag-2"] }))).toEqual(
    [task.key],
  );
  expect(keysOf(await search(harness, { tagIds: ["tag-2"] }))).toEqual([]);
  const statusId = textOf(
    (await callTool(harness, "read_ticket", { ticketId: task.id })) as Record<
      string,
      unknown
    >,
    "statusId",
  );
  expect(
    keysOf(await search(harness, { statusId, type: "task" })).sort(),
  ).toEqual([task.key, grouped.key, plain.key].sort());
  expect(
    keysOf(
      await search(harness, {
        type: "task",
        parentId: epic.id,
        assigneeId: "writer",
        milestoneId,
      }),
    ),
  ).toEqual([task.key]);
  const hit = listOf(
    await search(harness, { assigneeId: "writer" }),
    "tickets",
  )[0];
  expect(hit).toMatchObject({
    id: task.id,
    type: "task",
    parentId: epic.id,
    parentKey: epic.key,
    milestoneId,
    milestoneName: "Release",
    assignee: { id: "writer", displayName: "Visible writer" },
    department: { id: "alpha" },
    tags: [{ id: "tag-1", name: "Backend" }],
  });
});

it("pages through the matches without repeating or skipping one, also when tickets are added meanwhile", async () => {
  const harness = await setup();
  const created: string[] = [];
  for (let index = 0; index < 7; index += 1)
    created.push(
      (
        await createTicket(harness, {
          type: "task",
          title: `Ticket ${String(index)}`,
        })
      ).key,
    );
  const first = await search(harness, { limit: 3 });
  expect(first).toMatchObject({ total: 7 });
  expect(listOf(first, "tickets")).toHaveLength(3);
  expect(typeof first.nextCursor).toBe("string");
  const late = await createTicket(harness, { type: "task", title: "Late" });
  const rest = await collectPages(
    harness,
    "search_tickets",
    { projectId: "p1" },
    "tickets",
    3,
  );
  expect(rest.entries.map((ticket) => ticket.key)).toEqual([
    ...created,
    late.key,
  ]);
  const second = await search(harness, {
    limit: 3,
    cursor: first.nextCursor,
  });
  expect(keysOf(second)).toEqual(created.slice(3, 6));
  expect(new Set(rest.entries.map((ticket) => ticket.id)).size).toBe(8);
  expect(rest.pages).toBe(3);
});

it("neither lists nor counts hidden tickets and refuses a filter that names something hidden", async () => {
  const harness = await setup();
  const visible = await createTicket(harness, { type: "task", title: "Open" });
  const hiddenOne = await createTicket(harness, {
    type: "task",
    title: "Secret plan",
    description: "confidential roadmap",
    departmentId: "beta",
  });
  await createTicket(harness, {
    type: "task",
    title: "Secret plan two",
    departmentId: "beta",
  });
  expect(await search(harness, {})).toMatchObject({ total: 3 });

  actAs(harness, "writer");
  const seen = await search(harness, {});
  expect(keysOf(seen)).toEqual([visible.key]);
  expect(seen).toMatchObject({ total: 1, nextCursor: null });
  expect(
    await search(harness, { text: "confidential", limit: 1 }),
  ).toMatchObject({ total: 0, tickets: [], nextCursor: null });
  const paged = await collectPages(
    harness,
    "search_tickets",
    { projectId: "p1" },
    "tickets",
    1,
  );
  expect(paged.entries.map((ticket) => ticket.key)).toEqual([visible.key]);
  expect(paged.pages).toBe(1);
  for (const filter of [
    { departmentId: "beta" },
    { assigneeId: "hidden" },
    { assigneeGroupId: "hidden-group" },
    { parentId: hiddenOne.id },
  ])
    expect(await search(harness, filter), JSON.stringify(filter)).toEqual(
      await search(harness, {
        ...Object.fromEntries(
          Object.keys(filter).map((key) => [key, "missing-record"]),
        ),
      }),
    );
  expect(await search(harness, { departmentId: "beta" })).toMatchObject({
    code: "NOT_FOUND",
  });
  expect(
    await callTool(harness, "search_tickets", { projectId: "p2" }),
  ).toMatchObject({ code: "NOT_FOUND" });
});

it("rejects malformed queries, foreign cursors and a parent of another project", async () => {
  const harness = await setup();
  const task = await createTicket(harness, { type: "task" });
  const foreign = await callTool(harness, "create_ticket", {
    operationId: operationId(),
    projectId: "p2",
    type: "initiative",
    title: "Other project",
    description: "",
    statusId: null,
    parentId: null,
  });
  const invalid: Record<string, unknown>[] = [
    { text: "" },
    { text: "x".repeat(201) },
    { type: "story" },
    { limit: 0 },
    { limit: 101 },
    { unknown: true },
    { assigneeId: "writer", assigneeGroupId: "visible-group" },
    { tagIds: "tag-1" },
    { cursor: "not-a-cursor" },
    { parentId: "has spaces" },
  ];
  for (const parameters of invalid)
    expect(
      await search(harness, parameters),
      JSON.stringify(parameters),
    ).toEqual({ code: "INVALID_REQUEST" });
  expect(await callTool(harness, "search_tickets", {})).toEqual({
    code: "INVALID_REQUEST",
  });
  expect(
    await search(harness, { parentId: textOf(foreign, "ticketId") }),
  ).toEqual({ code: "INVALID_REQUEST" });
  expect(await search(harness, { statusId: "no-such-status" })).toEqual(
    NOT_FOUND,
  );
  expect(await search(harness, { milestoneId: "no-such-milestone" })).toEqual(
    NOT_FOUND,
  );
  expect(await search(harness, { tagIds: ["no-such-tag"] })).toEqual(NOT_FOUND);
  await createTicket(harness, { type: "task", title: "Second" });
  const first = await search(harness, { limit: 1 });
  expect(
    await search(harness, { cursor: first.nextCursor, text: "Second" }),
  ).toEqual({
    code: "INVALID_REQUEST",
  });
  expect(
    await search(harness, { cursor: first.nextCursor, limit: 1 }),
  ).toMatchObject({
    tickets: [expect.objectContaining({ title: "Second" })],
  });
  expect(task.key).toBeTruthy();
});

it("lists assignment targets from the visible directory without choosing between equal names", async () => {
  const harness = await setup();
  await harness.addUser("twin-a", {
    displayName: "Twin Person",
    departments: ["alpha"],
  });
  await harness.addUser("twin-b", {
    displayName: "twin person",
    departments: ["alpha"],
  });
  actAs(harness, "writer");
  const named = await callTool(harness, "search_assignment_targets", {
    text: "twin person",
  });
  const people = listOf(named, "targets").filter(
    (target) => target.targetType === "person",
  );
  expect(people.map((person) => person.id).sort()).toEqual([
    "twin-a",
    "twin-b",
  ]);
  expect(people.every((person) => person.isExactMatch === true)).toBe(true);
  expect(people[0]).toMatchObject({
    departments: [expect.objectContaining({ id: "alpha" })],
    groups: [],
  });
  const visibleGroup = await callTool(harness, "search_assignment_targets", {
    text: "visible",
  });
  expect(listOf(visibleGroup, "targets")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        targetType: "person",
        id: "writer",
        name: "Visible writer",
        isExactMatch: false,
      }),
      expect.objectContaining({
        targetType: "group",
        id: "visible-group",
        name: "Visible group",
        isExactMatch: false,
      }),
    ]),
  );
  const departments = await callTool(harness, "search_assignment_targets", {
    targetType: "department",
  });
  expect(listOf(departments, "targets")).toEqual([
    expect.objectContaining({ targetType: "department", id: "alpha" }),
  ]);
  const secret = JSON.stringify(
    await callTool(harness, "search_assignment_targets", { text: "hidden" }),
  );
  expect(secret).not.toContain("Hidden name");
  expect(secret).not.toContain("hidden-group");
  expect(
    await callTool(harness, "search_assignment_targets", { projectId: "p2" }),
  ).toEqual(NOT_FOUND);
  expect(
    await callTool(harness, "search_assignment_targets", { text: "" }),
  ).toEqual({ code: "INVALID_REQUEST" });
  expect(
    await callTool(harness, "search_assignment_targets", {
      targetType: "team",
    }),
  ).toEqual({ code: "INVALID_REQUEST" });

  actAs(harness, "owner");
  const asOwner = await callTool(harness, "search_assignment_targets", {
    text: "Hidden",
  });
  expect(listOf(asOwner, "targets").map((target) => target.id)).toEqual(
    expect.arrayContaining(["hidden", "hidden-group"]),
  );
});

it("pages assignment targets with a stable cursor", async () => {
  const harness = await setup();
  const everything = await collectPages(
    harness,
    "search_assignment_targets",
    {},
    "targets",
    2,
  );
  const identifiers = everything.entries.map(
    (target) => `${textOf(target, "targetType")}:${textOf(target, "id")}`,
  );
  expect(new Set(identifiers).size).toBe(identifiers.length);
  const total = (await callTool(harness, "search_assignment_targets", {}))
    .total;
  expect(identifiers).toHaveLength(Number(total));
  expect(everything.pages).toBeGreaterThan(1);
});
