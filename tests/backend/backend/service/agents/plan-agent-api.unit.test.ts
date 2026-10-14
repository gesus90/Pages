import { beforeEach, expect, it } from "vitest";

import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import { AgentProjectService } from "@/backend/service/mcp/AgentProjectService";
import { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import { PersonalAgentTokenService } from "@/backend/service/mcp/PersonalAgentTokenService";
import {
  AGENT_PLAN_READ_OPERATIONS,
  AGENT_PLAN_WRITE_OPERATIONS,
} from "@/definition/AgentPlanOperations";

import { PlanWorld, runnablePlan } from "./plan-operation-world";

import type { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import type { PersonalAgentTokenRepository } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import type { AgentIdentity } from "@/definition/McpAuthorization";

/** Stands in for a dependency the tested path never reaches. */
const UNUSED: unknown = Object.create(null);

let world = new PlanWorld();

/** A personal credential store with one token per synthetic person. */
class PersonalTokens extends PersonalAgentTokenService {
  public constructor() {
    super(
      UNUSED as PersonalAgentTokenRepository,
      UNUSED as AgentIdentityService,
    );
  }

  /** Resolves `token-<person>` to that person. */
  public override async verify(token: string): Promise<AgentIdentity> {
    if (!token.startsWith("token-"))
      throw new McpAuthorizationError("invalid_token", 401);
    return world.identity(token.slice("token-".length));
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
      plans: world.operations,
    }),
    new SessionTokens(),
  );
}

beforeEach(() => {
  world = new PlanWorld();
  world.seed(runnablePlan("plan-a", { name: "Alpha" }));
});

it("offers every plan operation to a verified personal credential", async () => {
  const response = await api().handle("token-reader", {
    operation: "verify",
    parameters: {},
  });

  const offered = (response as { tools: readonly string[] }).tools;
  for (const operation of [
    ...AGENT_PLAN_READ_OPERATIONS,
    ...AGENT_PLAN_WRITE_OPERATIONS,
  ])
    expect(offered).toContain(operation);
});

it("serves plan reads and changes through the same API as every other operation", async () => {
  const listed = await api().handle("token-owner", {
    operation: "plans.list",
    parameters: {},
  });
  const changed = await api().handle("token-owner", {
    operation: "plans.parameter.create",
    parameters: {
      operationId: "api-1",
      planId: "plan-a",
      expectedRevision: 1,
      name: "branch",
      value: { type: "text", text: "main" },
    },
  });

  expect(listed).toMatchObject({
    apiVersion: "1",
    result: { total: 1, plans: [{ id: "plan-a", name: "Alpha" }] },
  });
  expect(changed).toMatchObject({
    apiVersion: "1",
    result: { planId: "plan-a", changed: true, revision: 2 },
  });
});

it("refuses changes by someone the plan is only shared with", async () => {
  await expect(
    api().handle("token-reader", {
      operation: "plans.update",
      parameters: {
        operationId: "api-2",
        planId: "plan-a",
        expectedRevision: 1,
        name: "Taken",
      },
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
});

it("does not offer or run plan operations for the credential of a plan session", async () => {
  const offered = await api().handle("session-token", {
    operation: "verify",
    parameters: {},
  });

  expect(offered).toMatchObject({ tools: ["ticket.read"] });
  await expect(
    api().handle("session-token", {
      operation: "plans.list",
      parameters: { ticketId: "PAGE-1" },
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
