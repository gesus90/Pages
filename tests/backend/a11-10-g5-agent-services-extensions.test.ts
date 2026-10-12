import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { WikiConflictError } from "@/backend/error/WikiErrors";
import { readAgentExtension } from "@/backend/service/agents/AgentExtensionReads";
import { readParameterRecord } from "@/backend/service/agents/AgentParameterReader";
import { applyAgentPlanningExtension } from "@/backend/service/agents/AgentPlanningExtensions";
import { createAgentTaskContext } from "@/backend/service/agents/AgentTaskAccess";
import { AgentTicketTransaction } from "@/backend/service/agents/AgentTicketTransaction";
import { CAPABILITY } from "@/definition/Authorization";

import { useA11McpHarness } from "../helpers/a11-mcp";
import { pageInput } from "../helpers/wiki-harness";

const setup = useA11McpHarness();
type Harness = Awaited<ReturnType<typeof setup>>;

const CONFIRMATION = "LÖSCHEN";

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

async function taskContext(run: Harness, userId = "owner") {
  const actor = await new UserRepository(run.database).findById(userId);
  if (!actor) throw new Error("Missing fixture user.");
  return createAgentTaskContext(run.database, actor);
}

async function createTicket(
  run: Harness,
  parameters: Readonly<Record<string, unknown>>,
): Promise<string> {
  const created = await api(run, "ticket.create", {
    projectId: "p1",
    description: "",
    parentId: null,
    statusId: null,
    milestoneId: null,
    ...parameters,
  });
  return resultField(created, "ticketId");
}

function resultField(response: unknown, field: string): string {
  const result = readParameterRecord(readParameterRecord(response).result);
  return String(result[field]);
}

/** Replaces the permission set of a fixture person's role; the account keeps its departments. */
async function setPermissions(
  run: Harness,
  userId: string,
  permissions: readonly (typeof CAPABILITY)[keyof typeof CAPABILITY][],
): Promise<void> {
  const authorization = new AuthorizationRepository(run.database);
  const role = (await authorization.snapshot()).accounts.find(
    (candidate) => candidate.userId === userId,
  )?.role;
  if (!role) throw new Error("Missing fixture role.");
  await authorization.saveRole({ ...role, permissions: [...permissions] });
}

describe("A11.10 g5: project members and the extension read dispatcher", () => {
  it("lists a person with the role they hold in the project", async () => {
    const run = await setup();
    await api(run, "projects.member.assign", {
      operationId: "assign-writer",
      projectId: "p1",
      targetType: "person",
      targetId: "writer",
      role: "member",
    });
    const result = await api(run, "projects.members.read", {
      projectId: "p1",
    });
    expect(result).toMatchObject({
      result: {
        projectId: "p1",
        members: expect.arrayContaining([
          expect.objectContaining({ id: "writer", role: "member" }),
        ]),
      },
    });
    expect(JSON.stringify(result)).not.toContain('"id":"reader"');
  });

  it("refuses the ticket list as a directory read, because the planning service owns it", async () => {
    const run = await setup();
    await expect(
      readAgentExtension(await taskContext(run), "projects.tickets.list", {
        projectId: "p1",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("does not list an account whose person has vanished from the directory", async () => {
    const run = await setup();
    const authorization = new AuthorizationRepository(run.database);
    const snapshot = await authorization.snapshot();
    const template = snapshot.accounts.find(
      ({ userId }) => userId === "writer",
    );
    if (!template) throw new Error("Missing writer.");
    vi.spyOn(AuthorizationRepository.prototype, "snapshot").mockResolvedValue({
      ...snapshot,
      accounts: [...snapshot.accounts, { ...template, userId: "ghost" }],
    });
    const result = await api(run, "people.visible.list", {});
    const text = JSON.stringify(result);
    expect(text).toContain('"id":"writer"');
    expect(text).not.toContain("ghost");
  });
});

describe("A11.10 g5: outline of headings below quotes and lists", () => {
  it("reads headings nested in quotes and list items, with formatting and images inside", async () => {
    const run = await setup();
    const page = await run.service.create(
      run.owner,
      pageInput({
        title: "Outline",
        content: [
          "# Plain",
          "",
          "## With *emphasis* and ![logo](https://example.invalid/a.png)",
          "",
          "> ### Quoted",
          "",
          "- #### Listed",
          "",
          "Paragraph",
        ].join("\n"),
      }),
    );
    const result = await api(run, "wiki.outline.read", { pageId: page.id });
    expect(result).toMatchObject({
      result: {
        pageId: page.id,
        headings: [
          { level: 1, text: "Plain" },
          { level: 2, text: "With emphasis and " },
          { level: 3, text: "Quoted" },
          { level: 4, text: "Listed" },
        ],
        total: 4,
      },
    });
  });
});

describe("A11.10 g5: replay revalidates what the stored result refers to", () => {
  it("replays the deletion of an instance page that belongs to no project", async () => {
    const run = await setup();
    const page = await run.service.create(
      run.owner,
      pageInput({ title: "Instance page" }),
    );
    const parameters = {
      operationId: "delete-instance",
      pageId: page.id,
      expectedRevision: 1,
      confirmation: CONFIRMATION,
    };
    const first = await api(run, "wiki.page.delete", parameters);
    expect(first).toMatchObject({
      result: { id: page.id, projectId: null, changed: true },
    });
    expect(await api(run, "wiki.page.delete", parameters)).toEqual(first);
  });

  it("revalidates page access when an anchor change is replayed", async () => {
    const run = await setup();
    const page = await run.service.create(
      run.owner,
      pageInput({ projectId: "p1", scope: "project", title: "Concept" }),
    );
    const parameters = {
      operationId: "anchors",
      pageId: page.id,
      anchors: [{ kind: "department", targetId: "alpha" }],
      expectedAnchors: [],
    };
    const first = await api(run, "wiki.page.setAnchors", parameters, "manager");
    expect(first).toMatchObject({ result: { id: page.id, changed: true } });
    expect(
      await api(run, "wiki.page.setAnchors", parameters, "manager"),
    ).toEqual(first);
    await setPermissions(run, "manager", [CAPABILITY.WRITE]);
    await expect(
      api(run, "wiki.page.setAnchors", parameters, "manager"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await setPermissions(run, "manager", [
      CAPABILITY.WRITE,
      CAPABILITY.MANAGE_PROJECTS,
    ]);
    await run.service.delete(run.owner, page.id);
    await expect(
      api(run, "wiki.page.setAnchors", parameters, "manager"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("revalidates the project write right when a project change is replayed", async () => {
    const run = await setup();
    const parameters = {
      operationId: "rename",
      projectId: "p1",
      name: "Renamed",
    };
    const first = await api(run, "projects.setName", parameters, "manager");
    expect(first).toMatchObject({ result: { projectId: "p1", changed: true } });
    expect(await api(run, "projects.setName", parameters, "manager")).toEqual(
      first,
    );
    await setPermissions(run, "manager", []);
    await expect(
      api(run, "projects.setName", parameters, "manager"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("revalidates the right to change departments when a department assignment is replayed", async () => {
    const run = await setup();
    const parameters = {
      operationId: "department",
      projectId: "p1",
      targetType: "department",
      targetId: "alpha",
      role: "member",
    };
    const first = await api(
      run,
      "projects.member.assign",
      parameters,
      "manager",
    );
    expect(first).toMatchObject({ result: { projectId: "p1", changed: true } });
    expect(
      await api(run, "projects.member.assign", parameters, "manager"),
    ).toEqual(first);
    await setPermissions(run, "manager", []);
    await expect(
      api(run, "projects.member.assign", parameters, "manager"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("falls back to the stored object id when a replay carries no project reference", async () => {
    const run = await setup();
    const parameters = {
      operationId: "legacy",
      projectId: "p1",
      name: "Legacy",
    };
    const keys = new AgentOperationKeyRepository(run.database);
    for (const userId of ["owner", "reader"])
      await keys.insert(userId, "legacy", {
        operation: "projects.setName",
        fingerprint: createHash("sha256")
          .update(JSON.stringify(parameters))
          .digest("hex"),
        resultJson: JSON.stringify({
          id: "p1",
          projectId: null,
          changed: true,
        }),
      });
    expect(await api(run, "projects.setName", parameters)).toMatchObject({
      result: { id: "p1", projectId: null },
    });
    await expect(
      api(run, "projects.setName", parameters, "reader"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("replays a milestone link with the initiative it refers to", async () => {
    const run = await setup();
    const initiativeId = await createTicket(run, {
      operationId: "initiative",
      type: "initiative",
      title: "Initiative",
    });
    const milestone = await api(run, "milestone.create", {
      operationId: "milestone",
      projectId: "p1",
      name: "Milestone",
      description: "",
      startAt: null,
      dueAt: null,
    });
    const milestoneId = resultField(milestone, "milestoneId");
    const parameters = {
      operationId: "link",
      projectId: "p1",
      milestoneId,
      initiativeId,
    };
    const first = await api(run, "milestone.initiative.add", parameters);
    expect(first).toMatchObject({
      result: { id: milestoneId, relatedId: initiativeId, changed: true },
    });
    expect(await api(run, "milestone.initiative.add", parameters)).toEqual(
      first,
    );
  });
});

describe("A11.10 g5: rejected extension writes", () => {
  it.each([0, -1, 1.5, "1", null])(
    "refuses the expected revision %j when deleting a wiki page",
    async (expectedRevision) => {
      const run = await setup();
      const page = await run.service.create(
        run.owner,
        pageInput({ title: "Keep" }),
      );
      await expect(
        api(run, "wiki.page.delete", {
          operationId: "bad-revision",
          pageId: page.id,
          expectedRevision,
          confirmation: CONFIRMATION,
        }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      expect(await run.repository.pages.findNode(page.id)).toMatchObject({
        deletedAt: null,
      });
    },
  );

  it("translates a wiki revision conflict of the transaction to a conflict", async () => {
    const run = await setup();
    const page = await run.service.create(run.owner, pageInput({ title: "P" }));
    vi.spyOn(AgentTicketTransaction.prototype, "run").mockRejectedValueOnce(
      new WikiConflictError(page),
    );
    await expect(
      api(run, "projects.setName", {
        operationId: "conflict",
        projectId: "p1",
        name: "Conflict",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it.each([
    ["not a list", "tag"],
    ["too many tags", Array.from({ length: 51 }, (_, index) => `tag-${index}`)],
    ["a repeated tag", ["tag", "tag"]],
  ])("refuses the tag list of a ticket with %s", async (_label, tagIds) => {
    const run = await setup();
    const ticketId = await createTicket(run, {
      operationId: "tagged",
      type: "task",
      title: "Tagged",
    });
    await expect(
      api(run, "ticket.setTags", {
        operationId: "bad-tags",
        ticketId,
        tagIds,
        expectedTagIds: [],
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      api(run, "ticket.setTags", {
        operationId: "bad-expected-tags",
        ticketId,
        tagIds: [],
        expectedTagIds: tagIds,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("rejects an operation that assigns nothing when it reaches the ticket assignment", async () => {
    const run = await setup();
    const ticketId = await createTicket(run, {
      operationId: "assignee",
      type: "task",
      title: "Assignee",
    });
    await expect(
      applyAgentPlanningExtension(await taskContext(run), "projects.setName", {
        ticketId,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});

describe("A11.10 g5: project creation and dates", () => {
  it("refuses a status outside the catalog before creating a project", async () => {
    const run = await setup();
    const before = await run.database.query("SELECT COUNT(*) FROM projects;");
    await expect(
      api(run, "projects.create", {
        operationId: "bad-status",
        name: "New",
        description: "",
        status: "finished-ish",
        departmentIds: [],
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(await run.database.query("SELECT COUNT(*) FROM projects;")).toEqual(
      before,
    );
  });

  it("clears a project date with null and keeps the other one", async () => {
    const run = await setup();
    expect(
      await api(run, "projects.setDates", {
        operationId: "set-dates",
        projectId: "p1",
        startDate: "2026-10-11",
        targetDate: null,
      }),
    ).toMatchObject({ result: { changed: true } });
    expect(
      await api(run, "projects.setDates", {
        operationId: "clear-dates",
        projectId: "p1",
        startDate: null,
        targetDate: "2026-12-31",
      }),
    ).toMatchObject({ result: { changed: true } });
    expect(
      await run.database.query(
        "SELECT start_date, target_date FROM projects WHERE id = 'p1';",
      ),
    ).toEqual([[null, "2026-12-31"]]);
  });
});
