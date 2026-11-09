import { beforeEach, expect, it } from "vitest";

import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import { AgentProjectService } from "@/backend/service/mcp/AgentProjectService";
import { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import {
  AGENT_PLAN_READ_OPERATIONS,
  AGENT_PLAN_WRITE_OPERATIONS,
} from "@/definition/AgentPlanOperations";

import { PlanWorld, runnablePlan } from "./plan-operation-world";

import type { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { AgentIdentity } from "@/definition/McpAuthorization";

/** Stands in for a dependency the tested path never reaches. */
const UNUSED: unknown = Object.create(null);

let world = new PlanWorld();

/** The session credential store: one token narrowed to the operation `ticket.read`. */
class SessionTokens extends AgentRunCredentialService {
  public constructor() {
    super(UNUSED as AgentRunCredentialRepository);
  }

  /** Resolves `token-<person>` to a full session of that person and the one known session token to its narrow scope. */
  public override async verify(token: string): Promise<AgentIdentity | null> {
    if (token.startsWith("token-"))
      return {
        ...world.identity(token.slice("token-".length)),
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

  expect(offered).toMatchObject({
    tools: ["ticket.read", "run.step.report", "run.step.progress"],
  });
  await expect(
    api().handle("session-token", {
      operation: "plans.list",
      parameters: { ticketId: "PAGE-1" },
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
