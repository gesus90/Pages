import { beforeEach, expect, it, vi } from "vitest";

import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import { AgentProjectService } from "@/backend/service/mcp/AgentProjectService";
import { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import {
  AGENT_WORKSPACE_READ_OPERATIONS,
  AGENT_WORKSPACE_WRITE_OPERATIONS,
} from "@/definition/AgentWorkspaceOperations";

import { WorkspaceWorld } from "./workspace-world";

import type { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { AgentIdentity } from "@/definition/McpAuthorization";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesystemModule } = await import("./memory-filesystem");
  return memoryFilesystemModule();
});

/** Stands in for a dependency the tested path never reaches. */
const UNUSED: unknown = Object.create(null);

let world = new WorkspaceWorld();

/** The session credential store: one token narrowed to the operation `ticket.read`. */
class SessionTokens extends AgentRunCredentialService {
  public constructor() {
    super(UNUSED as AgentRunCredentialRepository);
  }

  /** Resolves `personal-token` to a full session of the administrator and the one known session token to its narrow scope. */
  public override async verify(token: string): Promise<AgentIdentity | null> {
    if (token === "personal-token")
      return {
        ...world.identity("admin"),
        run: {
          runId: "run-1",
          stepId: "step-1",
          operations: [],
          tickets: [],
          reach: "full",
        },
      };
    if (token !== "session-token") return null;
    return {
      ...world.identity("admin"),
      run: {
        runId: "run-1",
        stepId: "step-1",
        operations: ["ticket.read"],
        tickets: [{ id: "ticket-1", key: "PAGE-1" }],
        reach: "tickets",
      },
    };
  }
}

function api(): PagesAgentApiService {
  return new PagesAgentApiService(
    new AgentProjectService(UNUSED as ProjectRepository),
    new AgentOperationRouter({
      projects: UNUSED as ProjectRepository,
      wiki: UNUSED as WikiRepository,
      users: { getById: async () => null },
      workspaces: world.operations,
    }),
    new SessionTokens(),
  );
}

beforeEach(() => {
  world = new WorkspaceWorld();
  world.addProject("linked");
  world.addPerson("admin", { isAdmin: true });
});

it("offers every workspace operation to a verified personal credential", async () => {
  const response = await api().handle("personal-token", {
    operation: "verify",
    parameters: {},
  });

  const offered = (response as { tools: readonly string[] }).tools;
  for (const operation of [
    ...AGENT_WORKSPACE_READ_OPERATIONS,
    ...AGENT_WORKSPACE_WRITE_OPERATIONS,
  ])
    expect(offered).toContain(operation);
});

it("serves the operations through the same API as every other one", async () => {
  const path = world.directory("/work/repo");

  const created = await api().handle("personal-token", {
    operation: "workspaces.create",
    parameters: {
      operationId: "create-1",
      name: "Repo",
      path,
      projectId: "linked",
    },
  });
  const listed = await api().handle("personal-token", {
    operation: "workspaces.list",
    parameters: {},
  });

  expect(created).toMatchObject({
    apiVersion: "1",
    result: { changed: true, revision: 1 },
  });
  expect(listed).toMatchObject({
    apiVersion: "1",
    result: { total: 1, workspaces: [{ name: "Repo", path }] },
  });
});

it("refuses an unknown credential before anything is read", async () => {
  await expect(
    api().handle("wrong-token", {
      operation: "workspaces.list",
      parameters: {},
    }),
  ).rejects.toMatchObject({ status: 401 });
});

it("does not offer or run them for the credential of an agent plan session", async () => {
  const offered = await api().handle("session-token", {
    operation: "verify",
    parameters: {},
  });

  expect(offered).toMatchObject({
    tools: ["ticket.read", "run.step.report"],
  });
  await expect(
    api().handle("session-token", {
      operation: "workspaces.list",
      parameters: { ticketId: "PAGE-1" },
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    api().handle("session-token", {
      operation: "workspaces.remove",
      parameters: {
        ticketId: "PAGE-1",
        operationId: "x",
        workspaceId: "y",
        expectedRevision: 1,
      },
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
