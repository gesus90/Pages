import { expect, it, vi } from "vitest";

import { createModelNodeRunners } from "@/app/lib/agent-plan-swarm.server";
import { MAX_ACP_SESSIONS } from "@/definition/AcpResource";

const captured = vi.hoisted(() => ({
  swarm: vi.fn<(input: unknown) => void>(),
  decision: vi.fn<(input: unknown) => void>(),
}));
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanSwarmRepository",
  () => ({ AgentPlanSwarmRepository: class {} }),
);
vi.mock("@/backend/service/agents/branching/AgentPlanDecisionModel", () => ({
  AgentPlanDecisionModel: class {
    public constructor(input: unknown) {
      captured.decision(input);
    }
  },
}));
vi.mock("@/backend/service/agents/swarm/AgentPlanSwarmRunner", () => ({
  AgentPlanSwarmRunner: class {
    public constructor(input: unknown) {
      captured.swarm(input);
    }
  },
}));

it("connects model runners to their collaborators and current scheduler capacity", () => {
  let limit = 0;
  const snapshot = vi.fn(() => ({
    options: { maxConcurrentAcpSessions: limit },
    active: ["one", "two"],
  }));
  const agents = {
    acpResourceScheduler: { snapshot },
    agentPlanExecution: {},
    agentProfileService: {},
    agentWorkspaceService: {},
  };
  const input = { database: {}, agents } as unknown as Parameters<
    typeof createModelNodeRunners
  >[0];
  const parts = { tasks: {}, sessions: {} } as unknown as Parameters<
    typeof createModelNodeRunners
  >[1];
  const runners = createModelNodeRunners(input, parts);
  expect(runners.decisions).toBeDefined();
  expect(runners.swarms).toBeDefined();
  expect(captured.decision).toHaveBeenCalledWith({
    execution: agents.agentPlanExecution,
    profiles: agents.agentProfileService,
    tasks: parts.tasks,
  });
  const config: unknown = captured.swarm.mock.calls[0]?.[0];
  expect(config).toEqual(
    expect.objectContaining({
      grants: parts.sessions,
      tasks: parts.tasks,
      workspaces: agents.agentWorkspaceService,
    }),
  );
  if (
    typeof config !== "object" ||
    config === null ||
    !("capacity" in config) ||
    typeof config.capacity !== "function"
  )
    throw new Error("Missing capacity callback");
  expect(config.capacity()).toEqual({ limit: MAX_ACP_SESSIONS, active: 2 });
  limit = 3;
  expect(config.capacity()).toEqual({ limit: 3, active: 2 });
});
