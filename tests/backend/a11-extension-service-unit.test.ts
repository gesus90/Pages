import { expect, it, vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  ProjectDepartmentError,
  ProjectManagementDeniedError,
} from "@/backend/error/ProjectErrors";
import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import { readAgentExtension } from "@/backend/service/agents/AgentExtensionReads";
import { AgentExtensionService } from "@/backend/service/agents/AgentExtensionService";
import { AgentPlanningReadService } from "@/backend/service/agents/AgentPlanningReadService";
import { AgentTicketAnnouncer } from "@/backend/service/agents/AgentTicketAnnouncer";
import { AgentTicketTransaction } from "@/backend/service/agents/AgentTicketTransaction";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import { createDatabase, createUser } from "../helpers/factories";

import type { AgentExtensionWriteOperation } from "@/definition/AgentExtensions";
import type { AgentIdentity } from "@/definition/McpAuthorization";

vi.mock("@/backend/service/agents/AgentExtensionReads", () => ({
  readAgentExtension: vi.fn(),
}));

const identity: AgentIdentity = {
  userId: "user-1",
  isAdmin: false,
  permissions: [],
};
const writes: readonly {
  operation: AgentExtensionWriteOperation;
  parameters: Record<string, unknown>;
}[] = [
  {
    operation: "wiki.page.delete",
    parameters: { pageId: "page", expectedRevision: 1 },
  },
  {
    operation: "projects.create",
    parameters: {
      name: "Project",
      description: "",
      status: "active",
      departmentIds: [],
    },
  },
  {
    operation: "projects.setName",
    parameters: { projectId: "project", name: "Project" },
  },
  {
    operation: "projects.setDescription",
    parameters: { projectId: "project", description: "" },
  },
  {
    operation: "projects.setStatus",
    parameters: { projectId: "project", status: "active" },
  },
  {
    operation: "projects.setDates",
    parameters: { projectId: "project", startDate: null, targetDate: null },
  },
  {
    operation: "projects.member.assign",
    parameters: {
      projectId: "project",
      targetType: "person",
      targetId: "user",
      role: "member",
    },
  },
  {
    operation: "projects.member.remove",
    parameters: {
      projectId: "project",
      targetType: "person",
      targetId: "user",
    },
  },
  {
    operation: "ticket.setAssignee",
    parameters: {
      ticketId: "ticket",
      targetType: "none",
      targetId: null,
      expectedAssigneeId: null,
      expectedAssigneeGroupId: null,
    },
  },
  {
    operation: "ticket.assignMilestone",
    parameters: {
      ticketId: "ticket",
      milestoneId: null,
      expectedMilestoneId: null,
    },
  },
  { operation: "ticket.delete", parameters: { ticketId: "ticket" } },
  {
    operation: "milestone.delete",
    parameters: { projectId: "project", milestoneId: "milestone" },
  },
];

function setup() {
  const database = createDatabase();
  const actor = createUser();
  const cache = new ServerCache();
  const planning = new AgentPlanningReadService({
    database,
    users: { getById: async () => actor },
  });
  const announcer = new AgentTicketAnnouncer({
    cache,
    events: new PagesEventPublisher(),
    publisher: null,
  });
  const service = new AgentExtensionService({
    database,
    cache,
    planning,
    announcer,
  });
  vi.mocked(readAgentExtension).mockResolvedValue({
    people: [],
    total: 0,
    nextCursor: null,
  });
  const methods = {
    actor: vi
      .spyOn(UserRepository.prototype, "findById")
      .mockResolvedValue(actor),
    transaction: vi
      .spyOn(AgentTicketTransaction.prototype, "run")
      .mockResolvedValue({
        actor,
        result: { id: "object", projectId: "project", changed: false },
        event: null,
        published: null,
      }),
    tickets: vi.spyOn(planning, "readProjectTickets").mockResolvedValue({
      apiVersion: "1",
      result: {
        projectId: "project",
        tickets: [],
        total: 0,
        nextCursor: null,
      },
    }),
    announce: vi.spyOn(announcer, "announce"),
    membership: vi.spyOn(cache, "invalidateProjectMembership"),
  };
  return { service, methods };
}

it.each(writes)(
  "binds validated $operation to a transaction and announces only its completed result",
  async ({ operation, parameters }) => {
    const run = setup();
    const input = { operationId: "unit-operation", ...parameters };
    await expect(
      run.service.handle(identity, operation, input),
    ).resolves.toEqual({
      apiVersion: "1",
      result: { id: "object", projectId: "project", changed: false },
    });
    expect(run.methods.transaction).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        userId: identity.userId,
        operation,
        request: input,
        needsWriteRight: operation.startsWith("ticket."),
      }),
    );
    expect(run.methods.announce).toHaveBeenCalledOnce();
    expect(run.methods.membership).toHaveBeenCalledTimes(
      operation.startsWith("projects.") ? 1 : 0,
    );
  },
);

it.each(writes)(
  "rejects unknown or missing parameters for $operation before starting a mutation",
  async ({ operation, parameters }) => {
    const run = setup();
    for (const input of [
      { operationId: "unit-operation", ...parameters, hiddenOverride: true },
      { ...parameters },
      { operationId: "unit-operation" },
    ]) {
      await expect(
        run.service.handle(identity, operation, input),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    }
    expect(run.methods.transaction).not.toHaveBeenCalled();
    expect(run.methods.announce).not.toHaveBeenCalled();
  },
);

it.each([undefined, null, "unowned.operation", "projects.delete"])(
  "leaves an unowned operation %j to the router",
  async (operation) => {
    const run = setup();
    await expect(
      run.service.handle(identity, operation, null),
    ).resolves.toBeNull();
    expect(run.methods.transaction).not.toHaveBeenCalled();
    expect(run.methods.actor).not.toHaveBeenCalled();
  },
);

it("delegates the project ticket list with its exact validated paging window", async () => {
  const run = setup();
  const parameters = { projectId: "project", limit: 1, cursor: "opaque" };
  await expect(
    run.service.handle(identity, "projects.tickets.list", parameters),
  ).resolves.toMatchObject({
    apiVersion: "1",
    result: { tickets: [], total: 0 },
  });
  expect(run.methods.tickets).toHaveBeenCalledExactlyOnceWith(
    identity,
    parameters,
  );
  expect(run.methods.actor).not.toHaveBeenCalled();
});

it.each([
  "departments.list",
  "groups.list",
  "people.visible.list",
  "wiki.outline.read",
  "wiki.links.read",
  "projects.members.read",
  "projects.activity.read",
  "projects.tickets.list",
])(
  "refuses extra read parameters for %s before consulting the database",
  async (operation) => {
    const run = setup();
    await expect(
      run.service.handle(identity, operation, {
        projectId: "project",
        pageId: "page",
        secret: "untrusted",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(run.methods.actor).not.toHaveBeenCalled();
    expect(run.methods.tickets).not.toHaveBeenCalled();
  },
);

it.each([
  null,
  createUser({ isActive: false }),
  createUser({ mustChangePassword: true }),
])(
  "revalidates account eligibility before reading an extension: %j",
  async (actor) => {
    const run = setup();
    run.methods.actor.mockResolvedValue(actor);
    await expect(
      run.service.handle(identity, "people.visible.list", {}),
    ).rejects.toMatchObject({ code: "invalid_token", status: 401 });
  },
);

it.each([
  [new WikiPageNotFoundError(), "NOT_FOUND"],
  [new WikiAccessDeniedError(), "FORBIDDEN"],
  [new ProjectManagementDeniedError(), "FORBIDDEN"],
  [new WikiValidationError("invalidDate"), "INVALID_REQUEST"],
  [new ProjectDepartmentError("invalidDepartment"), "INVALID_REQUEST"],
] as const)(
  "translates %s without announcing a failed mutation",
  async (failure, code) => {
    const run = setup();
    run.methods.transaction.mockRejectedValue(failure);
    await expect(
      run.service.handle(identity, "projects.setName", {
        operationId: "unit-operation",
        projectId: "project",
        name: "Project",
      }),
    ).rejects.toMatchObject({ code });
    expect(run.methods.announce).not.toHaveBeenCalled();
    expect(run.methods.membership).not.toHaveBeenCalled();
  },
);

it("preserves an already translated conflict and its revision details", async () => {
  const run = setup();
  const failure = new AgentOperationError("CONFLICT", { currentRevision: 7 });
  run.methods.transaction.mockRejectedValue(failure);
  await expect(
    run.service.handle(identity, "wiki.page.delete", {
      operationId: "unit-operation",
      pageId: "page",
      expectedRevision: 1,
    }),
  ).rejects.toBe(failure);
  expect(run.methods.announce).not.toHaveBeenCalled();
});

it("does not accept unrelated revision fields on project mutations", async () => {
  const run = setup();
  await expect(
    run.service.handle(identity, "projects.setName", {
      operationId: "unit-operation",
      projectId: "project",
      name: "Project",
      expectedRevision: 1,
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(run.methods.transaction).not.toHaveBeenCalled();
});

it.each([null, undefined, {}])(
  "reads a directory with an empty parameter window %j",
  async (parameters) => {
    const run = setup();
    await expect(
      run.service.handle(identity, "people.visible.list", parameters),
    ).resolves.toEqual({
      apiVersion: "1",
      result: { people: [], total: 0, nextCursor: null },
    });
    expect(readAgentExtension).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ actor: createUser(), channel: "mcp" }),
      "people.visible.list",
      {},
    );
  },
);

it("refuses an oversized read response before exposing it to the adapter", async () => {
  const run = setup();
  vi.mocked(readAgentExtension).mockResolvedValue({
    people: [
      {
        id: "person",
        displayName: "x".repeat(PAGES_AGENT_LIMITS.responseBytes),
        departments: [],
        groups: [],
      },
    ],
    total: 1,
    nextCursor: null,
  });
  await expect(
    run.service.handle(identity, "people.visible.list", {}),
  ).rejects.toMatchObject({
    code: "PAYLOAD_TOO_LARGE",
  });
});
