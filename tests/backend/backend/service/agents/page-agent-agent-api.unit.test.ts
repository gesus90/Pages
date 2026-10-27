import { beforeEach, expect, it, vi } from "vitest";

import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { isChatOperation } from "@/backend/service/chat/ChatToolCatalog";
import { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import { AgentProjectService } from "@/backend/service/mcp/AgentProjectService";
import { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import { PersonalAgentTokenService } from "@/backend/service/mcp/PersonalAgentTokenService";
import {
  PAGE_AGENT_READ_OPERATIONS,
  PAGE_AGENT_WRITE_OPERATIONS,
} from "@/definition/PageAgentOperations";

import { memoryFiles } from "./page-agent-files";
import { PageAgentWorld } from "./page-agent-world";

import type { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import type { PersonalAgentTokenRepository } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import type { AgentIdentity } from "@/definition/McpAuthorization";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesModule } = await import("./page-agent-files");
  return memoryFilesModule();
});

/** Stands in for a dependency the tested path never reaches. */
const UNUSED: unknown = Object.create(null);

let world = new PageAgentWorld();

/** A personal credential store that knows one token per person. */
class PersonalTokens extends PersonalAgentTokenService {
  public constructor() {
    super(
      UNUSED as PersonalAgentTokenRepository,
      UNUSED as AgentIdentityService,
    );
  }

  /** Resolves the known tokens to their person. */
  public override async verify(token: string): Promise<AgentIdentity> {
    if (token === "owner-token") return world.identity("owner");
    if (token === "other-token") return world.identity("other");
    throw new McpAuthorizationError("invalid_token", 401);
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
      ...world.identity("owner"),
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
    new PersonalTokens(),
    new AgentProjectService(UNUSED as ProjectRepository),
    new AgentOperationRouter({
      projects: UNUSED as ProjectRepository,
      wiki: UNUSED as WikiRepository,
      users: { getById: async () => null },
      pageAgents: world.operations,
    }),
    new SessionTokens(),
  );
}

beforeEach(() => {
  memoryFiles.reset();
  world = new PageAgentWorld();
  world.addPerson("owner");
  world.addPerson("other");
  world.addModel("model-1", { efforts: ["low", "medium"] });
});

it("offers the agent reads and none of the retired agent writes to a verified personal credential", async () => {
  const response = await api().handle("owner-token", {
    operation: "verify",
    parameters: {},
  });

  const offered = (response as { tools: readonly string[] }).tools;
  for (const operation of PAGE_AGENT_READ_OPERATIONS)
    expect(offered).toContain(operation);
  for (const operation of PAGE_AGENT_WRITE_OPERATIONS)
    expect(offered).not.toContain(operation);
});

it("serves the reads through the same API as every other one", async () => {
  world.seedAgent({
    id: "reviewer",
    ownerId: "owner",
    modelProfileId: "model-1",
    name: "Reviewer",
  });
  const listed = await api().handle("owner-token", {
    operation: "agents.list",
    parameters: {},
  });
  const hidden = await api().handle("other-token", {
    operation: "agents.list",
    parameters: {},
  });

  expect(listed).toMatchObject({
    apiVersion: "1",
    result: { total: 1, agents: [{ name: "Reviewer", ownerId: "owner" }] },
  });
  expect(hidden).toMatchObject({ result: { total: 0, agents: [] } });
});

it("refuses a retired agent write for every credential, whatever owner the request names", async () => {
  await expect(
    api().handle("other-token", {
      operation: "agents.create",
      parameters: { operationId: "create-1", name: "Mine", ownerId: "owner" },
    }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "operation_retired" },
  });

  expect(world.storedAgents()).toEqual([]);
});

it("refuses an unknown credential before anything is read", async () => {
  await expect(
    api().handle("wrong-token", {
      operation: "agents.list",
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
      operation: "agents.list",
      parameters: { ticketId: "PAGE-1" },
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    api().handle("session-token", {
      operation: "agents.create",
      parameters: { ticketId: "PAGE-1", operationId: "x", name: "Sneaky" },
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("offers user-agent changes to the signed-in chat assistant", () => {
  for (const operation of PAGE_AGENT_WRITE_OPERATIONS)
    expect(isChatOperation(operation)).toBe(true);
});
