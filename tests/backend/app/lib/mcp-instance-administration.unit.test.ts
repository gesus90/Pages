import { beforeEach, expect, it, vi } from "vitest";

import { createMcpServices } from "@/app/lib/mcp-services.server";
import { ChatInstanceAdministrationService } from "@/backend/service/agents/ChatInstanceAdministrationService";
import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { createAgentPlanningServices } from "@/backend/service/agents/AgentPlanningServices";

import type { AgentPlanningServices } from "@/backend/service/agents/AgentPlanningServices";
import type { Database } from "@/backend/database/Database";

const { fakeClasses, opaque, partial } = await vi.hoisted(
  async () => import("./service-wiring-fakes"),
);

vi.mock("@/backend/service/agents/AgentOperationRouter", () =>
  fakeClasses({ AgentOperationRouter: [] }),
);
vi.mock("@/backend/service/agents/ChatInstanceAdministrationService", () =>
  fakeClasses({ ChatInstanceAdministrationService: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanningServices", () => ({
  createAgentPlanningServices: vi.fn(),
}));

type Workspace = Parameters<typeof createMcpServices>[3];

const DATABASE = opaque<Database>("database");

function create(
  instanceAdministration?: Workspace["instanceAdministration"],
): ReturnType<typeof createMcpServices> {
  return createMcpServices(
    DATABASE,
    opaque("users"),
    opaque("administration"),
    {
      directory: "/srv/pages/data",
      wikiService: opaque("wiki service"),
      agentWorkspaces: partial({ forChannel: () => opaque("workspaces") }),
      pageAgents: opaque("page agents"),
      plans: opaque("plans"),
      ...(instanceAdministration ? { instanceAdministration } : {}),
    },
  );
}

/** The options of the operation router of the chat (first) or MCP (second). */
function routerOptions(
  index: 0 | 1,
): ConstructorParameters<typeof AgentOperationRouter>[0] {
  return vi.mocked(AgentOperationRouter).mock.calls[index][0];
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createAgentPlanningServices).mockReturnValue(
    partial<AgentPlanningServices>({
      reads: opaque("planning reads"),
      announcer: opaque("planning announcer"),
    }),
  );
});

it("gives only the chat the connection and instance settings administration", () => {
  const instanceAdministration: NonNullable<
    Workspace["instanceAdministration"]
  > = { connections: opaque("connections"), settings: opaque("settings") };

  create(instanceAdministration);

  expect(vi.mocked(ChatInstanceAdministrationService).mock.calls).toEqual([
    [{ database: DATABASE, ...instanceAdministration }],
  ]);
  expect(routerOptions(0).instanceAdministration).toBe(
    vi.mocked(ChatInstanceAdministrationService).mock.instances[0],
  );
  expect(routerOptions(1)).not.toHaveProperty("instanceAdministration");
});

it("leaves the instance administration out of the chat without its services", () => {
  create();

  expect(ChatInstanceAdministrationService).not.toHaveBeenCalled();
  expect(routerOptions(0)).not.toHaveProperty("instanceAdministration");
  expect(routerOptions(1)).not.toHaveProperty("instanceAdministration");
});
