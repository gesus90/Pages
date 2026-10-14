import { beforeEach, expect, it } from "vitest";

import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import { AgentProjectService } from "@/backend/service/mcp/AgentProjectService";
import { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import { PersonalAgentTokenService } from "@/backend/service/mcp/PersonalAgentTokenService";
import { AGENT_ADMIN_WRITE_OPERATIONS } from "@/definition/AgentAdministration";
import { PAGES_AGENT_WRITE_OPERATIONS } from "@/definition/PagesAgentWrites";

import { PlanWorld, runnablePlan } from "./plan-operation-world";

import type { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import type { PersonalAgentTokenRepository } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import type {
  AgentIdentity,
  AgentRunReach,
} from "@/definition/McpAuthorization";

/** Stands in for a dependency the tested path never reaches. */
const UNUSED: unknown = Object.create(null);

let world = new PlanWorld();

/** No personal credential is valid; only session credentials reach the API here. */
class NoPersonalTokens extends PersonalAgentTokenService {
  public constructor() {
    super(
      UNUSED as PersonalAgentTokenRepository,
      UNUSED as AgentIdentityService,
    );
  }

  /** Refuses every personal credential. */
  public override async verify(): Promise<AgentIdentity> {
    throw new McpAuthorizationError("invalid_token", 401);
  }
}

/** Session credentials named `<reach>-<person>`, without bound tickets. */
class SessionTokens extends AgentRunCredentialService {
  public constructor() {
    super(UNUSED as AgentRunCredentialRepository);
  }

  /** Resolves a session credential to its executor and reach. */
  public override async verify(token: string): Promise<AgentIdentity | null> {
    const [reach, person] = token.split("-");
    if ((reach !== "read" && reach !== "full") || !person) return null;
    const scopeReach: AgentRunReach = reach;
    return {
      ...world.identity(person),
      run: {
        runId: "run-1",
        stepId: "step-1",
        operations: [],
        tickets: [],
        reach: scopeReach,
      },
    };
  }
}

function api(): PagesAgentApiService {
  return new PagesAgentApiService(
    new NoPersonalTokens(),
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

const PARAMETER_CHANGE = {
  operation: "plans.parameter.create",
  parameters: {
    operationId: "session-1",
    planId: "plan-a",
    expectedRevision: 1,
    name: "branch",
    value: { type: "text", text: "main" },
  },
};

async function offered(token: string): Promise<readonly string[]> {
  const response = await api().handle(token, {
    operation: "verify",
    parameters: {},
  });
  return "tools" in response ? response.tools : [];
}

beforeEach(() => {
  world = new PlanWorld();
  world.seed(runnablePlan("plan-a", { name: "Alpha" }));
});

it("offers a read-only Codex session every read, without bound tickets, and no change at all", async () => {
  const tools = await offered("read-owner");
  expect(tools).toEqual(
    expect.arrayContaining([
      "projects.names.list",
      "ticket.read",
      "wiki.page.read",
      "wiki.comments.read",
      "plans.list",
      "agents.read",
    ]),
  );
  for (const operation of [...PAGES_AGENT_WRITE_OPERATIONS, "wiki.comment.add"])
    expect(tools).not.toContain(operation);
  const listed = await api().handle("read-owner", {
    operation: "plans.list",
    parameters: {},
  });
  expect(listed).toMatchObject({ result: { total: 1 } });
});

it("refuses every change of a read-only session on the server, also when a client calls it directly", async () => {
  await expect(
    api().handle("read-owner", PARAMETER_CHANGE),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const plan = await api().handle("full-owner", {
    operation: "plans.read",
    parameters: { planId: "plan-a" },
  });
  expect(plan).toMatchObject({ result: { plan: { revision: 1 } } });
});

it("lets a YOLO session call every operation of its executor under the normal Pages checks", async () => {
  const tools = await offered("full-owner");
  expect(tools).toContain("plans.parameter.create");
  expect(tools).toContain("ticket.checklist.setItem");
  expect(tools).not.toContain("assets.upload.prepare");
  for (const operation of AGENT_ADMIN_WRITE_OPERATIONS)
    expect(tools).not.toContain(operation);
  const changed = await api().handle("full-owner", PARAMETER_CHANGE);
  expect(changed).toMatchObject({
    result: { planId: "plan-a", changed: true, revision: 2 },
  });
  await expect(
    api().handle("full-reader", {
      ...PARAMETER_CHANGE,
      parameters: { ...PARAMETER_CHANGE.parameters, operationId: "session-2" },
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("never lets a session rotate, revoke or upload with its credential", async () => {
  for (const operation of [
    "credential.rotate",
    "credential.revoke",
    "assets.upload.prepare",
  ])
    await expect(
      api().handle("full-owner", { operation, parameters: {} }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
