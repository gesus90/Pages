import { describe, expect, it, vi } from "vitest";

import { TaskService } from "@/backend/service/TaskService";
import { readParameterRecord } from "@/backend/service/agents/AgentParameterReader";

import { useA11McpHarness } from "../helpers/a11-mcp";
import { pageInput } from "../helpers/wiki-harness";

const setup = useA11McpHarness();
type Harness = Awaited<ReturnType<typeof setup>>;

async function api(
  run: Harness,
  operation: string,
  parameters: Readonly<Record<string, unknown>>,
  userId = "owner",
) {
  return run.services.pagesAgentApiService.handle(
    run.tokens.get(userId) ?? "",
    {
      operation,
      parameters,
    },
  );
}

function resultField(response: unknown, field: string): string {
  const result = readParameterRecord(readParameterRecord(response).result);
  return String(result[field]);
}

async function createTicket(
  run: Harness,
  operationId: string,
  type: string,
  parentId: string | null = null,
): Promise<string> {
  return resultField(
    await api(run, "ticket.create", {
      operationId,
      projectId: "p1",
      type,
      title: `Ticket ${operationId}`,
      description: "",
      parentId,
      statusId: null,
      milestoneId: null,
    }),
    "ticketId",
  );
}

async function createMilestone(run: Harness, name: string): Promise<string> {
  return resultField(
    await api(run, "milestone.create", {
      operationId: `milestone-${name}`,
      projectId: "p1",
      name,
      description: "",
      startAt: null,
      dueAt: null,
    }),
    "milestoneId",
  );
}

function ticketsOf(response: unknown): readonly Record<string, unknown>[] {
  const tickets = readParameterRecord(
    readParameterRecord(response).result,
  ).tickets;
  if (!Array.isArray(tickets)) throw new Error("Missing tickets.");
  return tickets.map((ticket: unknown) => readParameterRecord(ticket));
}

describe("A11.10 g5: initiatives in the project ticket list", () => {
  it("shows the milestones of an initiative, and none for one without a link", async () => {
    const run = await setup();
    const linked = await createTicket(run, "linked", "initiative");
    const lonely = await createTicket(run, "lonely", "initiative");
    const milestoneId = await createMilestone(run, "Release");
    await api(run, "milestone.initiative.add", {
      operationId: "link",
      projectId: "p1",
      milestoneId,
      initiativeId: linked,
    });
    const tickets = ticketsOf(
      await api(run, "projects.tickets.list", { projectId: "p1" }),
    );
    expect(tickets.find(({ id }) => id === linked)).toMatchObject({
      linkedMilestones: [{ id: milestoneId, name: "Release" }],
    });
    expect(tickets.find(({ id }) => id === lonely)).toMatchObject({
      linkedMilestones: [],
    });
  });

  it("leaves out a link whose milestone is no longer listed", async () => {
    const run = await setup();
    const linked = await createTicket(run, "linked", "initiative");
    const milestoneId = await createMilestone(run, "Archived meanwhile");
    await api(run, "milestone.initiative.add", {
      operationId: "link",
      projectId: "p1",
      milestoneId,
      initiativeId: linked,
    });
    vi.spyOn(TaskService.prototype, "findMilestones").mockResolvedValue([]);
    const tickets = ticketsOf(
      await api(run, "projects.tickets.list", { projectId: "p1" }),
    );
    expect(tickets.find(({ id }) => id === linked)).toMatchObject({
      linkedMilestones: [],
    });
  });
});

describe("A11.10 g5: milestone reads and ticket links", () => {
  it("refuses an unknown parameter of the milestone read", async () => {
    const run = await setup();
    await expect(
      api(run, "milestones.read", { projectId: "p1", hidden: true }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(
      await api(run, "milestones.read", { projectId: "p1" }),
    ).toMatchObject({ result: { projectId: "p1" } });
  });

  it("counts no descendants below a subtask", async () => {
    const run = await setup();
    const task = await createTicket(run, "parent", "task");
    const subtask = await createTicket(run, "child", "subtask", task);
    expect(await api(run, "ticket.read", { ticketId: subtask })).toMatchObject({
      result: { id: subtask, descendantCount: 0 },
    });
    expect(await api(run, "ticket.read", { ticketId: task })).toMatchObject({
      result: { id: task, descendantCount: 1 },
    });
  });

  it("lists only the visible wiki pages of an epic", async () => {
    const run = await setup();
    const epic = await createTicket(run, "epic", "epic");
    const pages = [];
    for (const title of ["Kept page", "Trashed page"]) {
      const page = await run.service.create(
        run.owner,
        pageInput({ projectId: "p1", scope: "project", title }),
      );
      await api(run, "wiki.page.setAnchors", {
        operationId: `anchor-${title}`,
        pageId: page.id,
        anchors: [{ kind: "epic", targetId: epic }],
        expectedAnchors: [],
      });
      pages.push(page);
    }
    const [kept, trashed] = pages;
    if (!kept || !trashed) throw new Error("Missing pages.");
    expect(await api(run, "ticket.read", { ticketId: epic })).toMatchObject({
      result: {
        wikiPages: expect.arrayContaining([
          expect.objectContaining({ id: kept.id }),
          expect.objectContaining({ id: trashed.id }),
        ]),
      },
    });
    await run.service.delete(run.owner, trashed.id);
    expect(await api(run, "ticket.read", { ticketId: epic })).toMatchObject({
      result: { wikiPages: [{ id: kept.id, title: "Kept page" }] },
    });
  });
});

describe("A11.10 g5: credential revocation", () => {
  it("revokes the presented credential and refuses it afterwards", async () => {
    const run = await setup();
    const token = run.tokens.get("reader") ?? "";
    const service = run.services.pagesAgentApiService;
    expect(
      await service.handle(token, { operation: "credential.revoke" }),
    ).toEqual({ revoked: true });
    await expect(service.verify(token)).rejects.toMatchObject({ status: 401 });
    expect(
      await service.handle(run.tokens.get("writer") ?? "", {
        operation: "verify",
      }),
    ).toMatchObject({ identity: { userId: "writer" } });
  });
});
