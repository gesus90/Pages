import { beforeEach, expect, it, vi } from "vitest";

import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import { AgentProjectService } from "@/backend/service/mcp/AgentProjectService";
import { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import { PersonalAgentTokenService } from "@/backend/service/mcp/PersonalAgentTokenService";
import {
  AGENT_WORKSPACE_READ_OPERATIONS,
  AGENT_WORKSPACE_WRITE_OPERATIONS,
} from "@/definition/AgentWorkspaceOperations";

import { WorkspaceWorld } from "./workspace-world";

import type { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import type { PersonalAgentTokenRepository } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import type { AgentIdentity } from "@/definition/McpAuthorization";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesystemModule } = await import("./memory-filesystem");
  return memoryFilesystemModule();
});

/** Stands in for a dependency the tested path never reaches. */
const UNUSED: unknown = Object.create(null);

let world = new WorkspaceWorld();

/** A personal credential store that knows one token, owned by the administrator. */
class PersonalTokens extends PersonalAgentTokenService {
  public constructor() {
    super(
      UNUSED as PersonalAgentTokenRepository,
      UNUSED as AgentIdentityService,
    );
  }

  /** Resolves the one known token to the administrator. */
  public override async verify(token: string): Promise<AgentIdentity> {
    if (token !== "personal-token")
      throw new McpAuthorizationError("invalid_token", 401);
    return world.identity("admin");
  }

  /** Carries no credential details. */
  public override async credential(): Promise<null> {
    return null;
  }
}

/** The session credential store: one token narrowed to the operation `ticket.read`. */
class SessionTokens extends AgentRunCredentialService {
  public constructor() {
    super(UNUSED as AgentRunCredentialRepository);
  }

  /** Resolves the one known session token with its scope. */
  public override async verify(token: string): Promise<AgentIdentity | null> {
    if (token !== "session-token") return null;
    return {
      ...world.identity("admin"),
      run: {
        runId: "run-1",
        stepId: "step-1",
        operations: ["ticket.read"],
        tickets: [{ id: "ticket-1", key: "PAGE-1" }],
      },
    };
  }
}

function api(): PagesAgentApiService {
  return new PagesAgentApiService(
    new PersonalTokens(),
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

  expect(offered).toMatchObject({ tools: ["ticket.read"] });
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
