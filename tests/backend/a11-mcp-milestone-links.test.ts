import { describe, expect, it, vi } from "vitest";

import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { createAgentTaskContext } from "@/backend/service/agents/AgentTaskAccess";

import { a11Fetch, callA11Tool, useA11McpHarness } from "../helpers/a11-mcp";
import { pageInput } from "../helpers/wiki-harness";

const setup = useA11McpHarness();
type Harness = Awaited<ReturnType<typeof setup>>;

let counter = 0;

function use(harness: Harness, person: string): void {
  harness.configuration.token = harness.tokens.get(person) ?? "";
}

async function createTicket(
  harness: Harness,
  type: string,
  title: string,
  parentId: string | null = null,
  projectId = "p1",
): Promise<string> {
  counter += 1;
  const created = await callA11Tool(harness.connection, "create_ticket", {
    operationId: `ticket-${counter}`,
    projectId,
    type,
    title,
    description: "",
    parentId,
    statusId: null,
    milestoneId: null,
  });
  expect(created).toMatchObject({ ticketId: expect.any(String) });
  return String(created.ticketId);
}

async function createMilestone(
  harness: Harness,
  name: string,
  projectId = "p1",
): Promise<string> {
  counter += 1;
  const created = await callA11Tool(harness.connection, "create_milestone", {
    operationId: `milestone-${counter}`,
    projectId,
    name,
    description: `${name} description`,
    startAt: null,
    dueAt: null,
  });
  return String(created.milestoneId);
}

async function assign(
  harness: Harness,
  ticketId: string,
  milestoneId: string | null,
  expectedMilestoneId: string | null,
): Promise<Record<string, unknown>> {
  counter += 1;
  return callA11Tool(harness.connection, "assign_ticket_to_milestone", {
    operationId: `assign-${counter}`,
    ticketId,
    milestoneId,
    expectedMilestoneId,
  });
}

async function link(
  harness: Harness,
  tool: "add_milestone_initiative" | "remove_milestone_initiative",
  milestoneId: string,
  initiativeId: string,
  projectId = "p1",
): Promise<Record<string, unknown>> {
  counter += 1;
  return callA11Tool(harness.connection, tool, {
    operationId: `link-${counter}`,
    projectId,
    milestoneId,
    initiativeId,
  });
}

async function readTicket(
  harness: Harness,
  ticketId: string,
): Promise<Record<string, unknown>> {
  return callA11Tool(harness.connection, "read_ticket", { ticketId });
}

describe("A11.5 AK-03/AK-04: hierarchy and the thread of milestones", () => {
  it("threads a task milestone up to its epic and initiative and refuses to unlink while something below uses it", async () => {
    const harness = await setup();
    vi.stubGlobal("fetch", a11Fetch(harness));
    const initiative = await createTicket(harness, "initiative", "Initiative");
    const epic = await createTicket(harness, "epic", "Epic", initiative);
    const task = await createTicket(harness, "task", "Task", epic);
    const first = await createMilestone(harness, "First");
    const second = await createMilestone(harness, "Second");

    // Assigning the task links the epic and the initiative with the milestone.
    expect(await assign(harness, task, first, null)).toMatchObject({
      changed: true,
    });
    expect(await readTicket(harness, epic)).toMatchObject({
      milestoneId: first,
    });
    expect(await readTicket(harness, initiative)).toMatchObject({
      linkedMilestones: [{ id: first, name: "First" }],
    });
    expect(
      await callA11Tool(harness.connection, "read_milestones", {
        projectId: "p1",
      }),
    ).toMatchObject({
      milestones: expect.arrayContaining([
        expect.objectContaining({
          id: first,
          initiatives: [expect.objectContaining({ id: initiative })],
        }),
        expect.objectContaining({ id: second, initiatives: [] }),
      ]),
    });

    // A second milestone is linked too; the epic keeps the one it carries.
    expect(await assign(harness, task, second, first)).toMatchObject({
      changed: true,
    });
    expect(await readTicket(harness, epic)).toMatchObject({
      milestoneId: first,
    });
    const linked = await readTicket(harness, initiative);
    expect(linked.linkedMilestones).toEqual(
      expect.arrayContaining([
        { id: first, name: "First" },
        { id: second, name: "Second" },
      ]),
    );

    // The epic still carries the first milestone, so the link stays.
    expect(
      await link(harness, "remove_milestone_initiative", first, initiative),
    ).toMatchObject({ code: "CONFLICT" });
    expect(await assign(harness, epic, second, first)).toMatchObject({
      changed: true,
    });
    expect(
      await link(harness, "remove_milestone_initiative", first, initiative),
    ).toMatchObject({ changed: true, relatedId: initiative });
    expect(
      await link(harness, "remove_milestone_initiative", first, initiative),
    ).toMatchObject({ changed: false });
    expect(await readTicket(harness, initiative)).toMatchObject({
      linkedMilestones: [{ id: second, name: "Second" }],
    });

    // An explicit link is added once.
    expect(
      await link(harness, "add_milestone_initiative", first, initiative),
    ).toMatchObject({ changed: true, id: first, relatedId: initiative });
    expect(
      await link(harness, "add_milestone_initiative", first, initiative),
    ).toMatchObject({ changed: false });
  });

  it("threads the milestone of a task that is created below an epic", async () => {
    const harness = await setup();
    vi.stubGlobal("fetch", a11Fetch(harness));
    const initiative = await createTicket(harness, "initiative", "Initiative");
    const epic = await createTicket(harness, "epic", "Epic", initiative);
    const milestone = await createMilestone(harness, "Milestone");
    counter += 1;
    expect(
      await callA11Tool(harness.connection, "create_ticket", {
        operationId: `ticket-${counter}`,
        projectId: "p1",
        type: "task",
        title: "Task",
        description: "",
        parentId: epic,
        statusId: null,
        milestoneId: milestone,
      }),
    ).toMatchObject({ ticketId: expect.any(String) });
    expect(await readTicket(harness, epic)).toMatchObject({
      milestoneId: milestone,
    });
    expect(await readTicket(harness, initiative)).toMatchObject({
      linkedMilestones: [{ id: milestone, name: "Milestone" }],
    });
  });

  it("links only initiatives of the project of the milestone", async () => {
    const harness = await setup();
    vi.stubGlobal("fetch", a11Fetch(harness));
    const initiative = await createTicket(harness, "initiative", "Initiative");
    const epic = await createTicket(harness, "epic", "Epic", initiative);
    const task = await createTicket(harness, "task", "Task", epic);
    const subtask = await createTicket(harness, "subtask", "Subtask", task);
    const milestone = await createMilestone(harness, "Milestone");
    const foreign = await createMilestone(harness, "Foreign", "p2");
    for (const ticket of [epic, task, subtask])
      expect(
        await link(harness, "add_milestone_initiative", milestone, ticket),
      ).toMatchObject({ code: "INVALID_REQUEST" });
    expect(
      await link(harness, "add_milestone_initiative", foreign, initiative),
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(
      await link(harness, "add_milestone_initiative", "missing", initiative),
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(
      await link(
        harness,
        "add_milestone_initiative",
        foreign,
        initiative,
        "p2",
      ),
    ).toMatchObject({ code: "NOT_FOUND" });
    // The threading is limited to tasks: an epic or a subtask starts nothing.
    expect(await assign(harness, subtask, milestone, null)).toMatchObject({
      changed: true,
    });
    expect(await readTicket(harness, epic)).toMatchObject({
      milestoneId: null,
    });
    expect(await readTicket(harness, initiative)).toMatchObject({
      linkedMilestones: [],
    });
  });

  it("refuses links and unlinking without the ticket rights and for hidden initiatives", async () => {
    const harness = await setup();
    vi.stubGlobal("fetch", a11Fetch(harness));
    const initiative = await createTicket(harness, "initiative", "Initiative");
    const hidden = await createTicket(harness, "initiative", "Hidden");
    const milestone = await createMilestone(harness, "Milestone");
    counter += 1;
    expect(
      await callA11Tool(harness.connection, "set_ticket_assignee", {
        operationId: `department-${counter}`,
        ticketId: hidden,
        targetType: "department",
        targetId: "beta",
        expectedAssigneeId: null,
        expectedAssigneeGroupId: null,
        expectedDepartmentId: null,
      }),
    ).toMatchObject({ changed: true });
    expect(
      await link(harness, "add_milestone_initiative", milestone, hidden),
    ).toMatchObject({ changed: true });
    expect(
      await link(harness, "add_milestone_initiative", milestone, initiative),
    ).toMatchObject({ changed: true });

    use(harness, "reader");
    for (const tool of [
      "add_milestone_initiative",
      "remove_milestone_initiative",
    ] as const)
      expect(await link(harness, tool, milestone, initiative)).toMatchObject({
        code: "FORBIDDEN",
      });

    use(harness, "writer");
    expect(
      await link(harness, "remove_milestone_initiative", milestone, hidden),
    ).toMatchObject({ code: "NOT_FOUND" });
    const milestones = await callA11Tool(
      harness.connection,
      "read_milestones",
      { projectId: "p1" },
    );
    expect(milestones).toMatchObject({
      milestones: [
        expect.objectContaining({
          id: milestone,
          initiatives: [expect.objectContaining({ id: initiative })],
        }),
      ],
    });
    expect(JSON.stringify(milestones)).not.toContain(hidden);
    expect(JSON.stringify(milestones)).not.toContain("Hidden");
    expect(await readTicket(harness, hidden)).toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

it("manages milestones and tickets completely: create, change every field, assign, delete with confirmation", async () => {
  const harness = await setup();
  vi.stubGlobal("fetch", a11Fetch(harness));
  const milestone = await createMilestone(harness, "Alpha");
  const call = (tool: string, input: Record<string, unknown>) => {
    counter += 1;
    return callA11Tool(harness.connection, tool, {
      operationId: `flow-${counter}`,
      ...input,
    });
  };
  for (const [tool, input] of [
    ["set_milestone_name", { expectedName: "Alpha", name: "Beta" }],
    [
      "set_milestone_description",
      { expectedDescription: "Alpha description", description: "Release" },
    ],
    ["set_milestone_status", { expectedStatus: "open", status: "completed" }],
    ["set_milestone_start", { expectedStartAt: null, startAt: "2026-11-01" }],
    ["set_milestone_due", { expectedDueAt: null, dueAt: "2026-12-01" }],
  ] as const)
    expect(
      await call(tool, { milestoneId: milestone, ...input }),
    ).toMatchObject({ changed: true });
  expect(
    await callA11Tool(harness.connection, "read_milestones", {
      projectId: "p1",
    }),
  ).toMatchObject({
    milestones: [
      {
        id: milestone,
        name: "Beta",
        description: "Release",
        status: "completed",
        startAt: "2026-11-01",
        dueAt: "2026-12-01",
      },
    ],
  });

  const initiative = await createTicket(harness, "initiative", "Initiative");
  const epic = await createTicket(harness, "epic", "Epic");
  expect(
    await call("set_ticket_parent", {
      ticketId: epic,
      expectedParentId: null,
      parentId: initiative,
    }),
  ).toMatchObject({ changed: true });
  expect(
    await call("set_ticket_title", {
      ticketId: epic,
      expectedTitle: "Epic",
      title: "Renamed",
    }),
  ).toMatchObject({ changed: true });
  expect(
    await call("set_ticket_description", {
      ticketId: epic,
      expectedDescription: "",
      description: "Text",
    }),
  ).toMatchObject({ changed: true });
  const read = await readTicket(harness, epic);
  const done = (read.statuses as { id: string; isDone: boolean }[]).find(
    ({ isDone }) => isDone,
  );
  expect(
    await call("set_ticket_status", {
      ticketId: epic,
      expectedStatusId: read.statusId,
      statusId: done?.id,
    }),
  ).toMatchObject({ changed: true });
  expect(
    await call("set_ticket_assignee", {
      ticketId: epic,
      targetType: "person",
      targetId: "writer",
      expectedAssigneeId: null,
      expectedAssigneeGroupId: null,
    }),
  ).toMatchObject({ changed: true });
  expect(await readTicket(harness, epic)).toMatchObject({
    title: "Renamed",
    description: "Text",
    isDone: true,
    parentId: initiative,
    assignee: { id: "writer" },
  });

  // A type outside the hierarchy is refused: a task cannot sit below an initiative.
  const task = await createTicket(harness, "task", "Task");
  expect(
    await call("set_ticket_parent", {
      ticketId: task,
      expectedParentId: null,
      parentId: initiative,
    }),
  ).toMatchObject({ code: "INVALID_REQUEST" });

  expect(
    await call("delete_milestone", {
      projectId: "p1",
      milestoneId: milestone,
    }),
  ).toMatchObject({ code: "CONFIRMATION_REQUIRED" });
  expect(
    await call("delete_milestone", {
      projectId: "p1",
      milestoneId: milestone,
      confirmation: "LÖSCHEN",
    }),
  ).toMatchObject({ disposition: "trash" });
});

it("assigns tags from the catalog only and compares the tags that were read", async () => {
  const harness = await setup();
  vi.stubGlobal("fetch", a11Fetch(harness));
  const tasks = new TaskRepository(harness.database);
  await tasks.insertLabel({ id: "tag-b", name: "Bravo", color: "#112233" });
  await tasks.insertLabel({ id: "tag-a", name: "Alpha", color: "#445566" });
  const ticket = await createTicket(harness, "task", "Tagged");

  const catalog = await callA11Tool(harness.connection, "list_ticket_tags", {
    limit: 1,
  });
  expect(catalog).toMatchObject({
    total: 2,
    tags: [{ id: "tag-a", name: "Alpha", color: "#445566" }],
    nextCursor: expect.any(String),
  });
  expect(
    await callA11Tool(harness.connection, "list_ticket_tags", {
      cursor: catalog.nextCursor,
    }),
  ).toMatchObject({
    tags: [expect.objectContaining({ id: "tag-b" })],
    nextCursor: null,
  });

  const input = {
    operationId: "tags",
    ticketId: ticket,
    tagIds: ["tag-a", "tag-b"],
    expectedTagIds: [],
  };
  expect(
    await callA11Tool(harness.connection, "set_ticket_tags", {
      ...input,
      operationId: "unknown",
      tagIds: ["tag-a", "invented"],
    }),
  ).toMatchObject({ code: "INVALID_REQUEST" });
  expect(await readTicket(harness, ticket)).toMatchObject({ tags: [] });

  expect(
    await callA11Tool(harness.connection, "set_ticket_tags", input),
  ).toMatchObject({ changed: true, id: ticket });
  expect(await readTicket(harness, ticket)).toMatchObject({
    tags: [
      expect.objectContaining({ id: "tag-a", name: "Alpha" }),
      expect.objectContaining({ id: "tag-b", name: "Bravo" }),
    ],
  });
  expect(
    await callA11Tool(harness.connection, "set_ticket_tags", input),
  ).toMatchObject({ changed: true });

  // A stale read is a conflict; the tags someone else already set are no conflict.
  expect(
    await callA11Tool(harness.connection, "set_ticket_tags", {
      ...input,
      operationId: "stale",
      tagIds: ["tag-a"],
    }),
  ).toMatchObject({ code: "CONFLICT" });
  expect(
    await callA11Tool(harness.connection, "set_ticket_tags", {
      ...input,
      operationId: "same",
    }),
  ).toMatchObject({ changed: false });
  expect(
    await callA11Tool(harness.connection, "set_ticket_tags", {
      operationId: "remove",
      ticketId: ticket,
      tagIds: ["tag-b"],
      expectedTagIds: ["tag-a", "tag-b"],
    }),
  ).toMatchObject({ changed: true });
  expect(
    await callA11Tool(harness.connection, "list_project_tickets", {
      projectId: "p1",
    }),
  ).toMatchObject({
    tickets: [
      expect.objectContaining({
        id: ticket,
        tags: [expect.objectContaining({ id: "tag-b" })],
      }),
    ],
  });
  expect(
    await callA11Tool(harness.connection, "read_project_activity", {
      projectId: "p1",
    }),
  ).toMatchObject({
    entries: expect.arrayContaining([
      expect.objectContaining({ action: "ticket.setTags", source: "mcp" }),
    ]),
  });

  use(harness, "reader");
  expect(
    await callA11Tool(harness.connection, "set_ticket_tags", {
      ...input,
      operationId: "reader",
    }),
  ).toMatchObject({ code: "FORBIDDEN" });
  expect(
    await callA11Tool(harness.connection, "list_ticket_tags", {}),
  ).toMatchObject({ total: 2 });
});

it("names the descendants a deletion takes along, archives them recursively and restores them", async () => {
  const harness = await setup();
  vi.stubGlobal("fetch", a11Fetch(harness));
  const initiative = await createTicket(harness, "initiative", "Initiative");
  const epic = await createTicket(harness, "epic", "Epic", initiative);
  const task = await createTicket(harness, "task", "Task", epic);
  await createTicket(harness, "subtask", "Subtask", task);
  expect(await readTicket(harness, initiative)).toMatchObject({
    descendantCount: 3,
  });
  expect(await readTicket(harness, task)).toMatchObject({
    descendantCount: 1,
  });
  counter += 1;
  const deletion = {
    operationId: `delete-${counter}`,
    ticketId: initiative,
  };
  expect(
    await callA11Tool(harness.connection, "delete_ticket", deletion),
  ).toMatchObject({ code: "CONFIRMATION_REQUIRED" });
  expect(
    await callA11Tool(harness.connection, "delete_ticket", {
      ...deletion,
      confirmation: "LÖSCHEN",
    }),
  ).toMatchObject({
    affectedCount: 4,
    recursive: true,
    disposition: "trash",
  });
  for (const id of [initiative, epic, task])
    expect(await readTicket(harness, id)).toMatchObject({ isArchived: true });

  // The archive is the trash of tickets: the interface restores it with its subtree.
  const context = createAgentTaskContext(harness.database, harness.owner);
  await context.tasks.restore(harness.owner, initiative);
  for (const id of [initiative, epic, task])
    expect(await readTicket(harness, id)).toMatchObject({ isArchived: false });
});

it("ties wiki pages to milestones and epics, compares the anchors read and marks the change", async () => {
  const harness = await setup();
  vi.stubGlobal("fetch", a11Fetch(harness));
  const initiative = await createTicket(harness, "initiative", "Initiative");
  const epic = await createTicket(harness, "epic", "Epic", initiative);
  const milestone = await createMilestone(harness, "Milestone");
  const page = await harness.service.create(
    harness.owner,
    pageInput({ projectId: "p1", scope: "project", title: "Concept" }),
  );
  const input = {
    operationId: "anchors",
    pageId: page.id,
    anchors: [
      { kind: "milestone", targetId: milestone },
      { kind: "epic", targetId: epic },
    ],
    expectedAnchors: [],
  };
  expect(
    await callA11Tool(harness.connection, "set_wiki_page_anchors", {
      ...input,
      operationId: "unknown-target",
      anchors: [{ kind: "milestone", targetId: "missing" }],
    }),
  ).toMatchObject({ code: "INVALID_REQUEST" });
  expect(
    await callA11Tool(harness.connection, "set_wiki_page_anchors", input),
  ).toMatchObject({ changed: true, id: page.id });
  expect(
    await callA11Tool(harness.connection, "read_wiki_page", {
      pageId: page.id,
    }),
  ).toMatchObject({
    anchors: expect.arrayContaining([
      expect.objectContaining({ kind: "milestone", targetId: milestone }),
      expect.objectContaining({ kind: "epic", targetId: epic }),
    ]),
  });
  expect(
    await callA11Tool(harness.connection, "read_milestones", {
      projectId: "p1",
    }),
  ).toMatchObject({
    milestones: [
      expect.objectContaining({
        id: milestone,
        wikiPages: [{ id: page.id, title: "Concept" }],
      }),
    ],
  });
  expect(await readTicket(harness, epic)).toMatchObject({
    wikiPages: [{ id: page.id, title: "Concept" }],
  });
  expect(
    await callA11Tool(harness.connection, "set_wiki_page_anchors", {
      ...input,
      operationId: "stale",
      anchors: [],
    }),
  ).toMatchObject({ code: "CONFLICT" });
  expect(
    await callA11Tool(harness.connection, "read_project_activity", {
      projectId: "p1",
    }),
  ).toMatchObject({
    entries: expect.arrayContaining([
      expect.objectContaining({
        action: "wiki_page_anchors_changed",
        category: "wiki",
        source: "mcp",
      }),
    ]),
  });

  use(harness, "reader");
  expect(
    await callA11Tool(harness.connection, "set_wiki_page_anchors", {
      ...input,
      operationId: "reader",
      anchors: [],
      expectedAnchors: input.anchors,
    }),
  ).toMatchObject({ code: "FORBIDDEN" });
  use(harness, "owner");
  expect(
    await callA11Tool(harness.connection, "set_wiki_page_anchors", {
      ...input,
      operationId: "release",
      anchors: [],
      expectedAnchors: input.anchors,
    }),
  ).toMatchObject({ changed: true });
  expect(
    await callA11Tool(harness.connection, "read_wiki_page", {
      pageId: page.id,
    }),
  ).toMatchObject({ anchors: [] });
});
