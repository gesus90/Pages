import { AgentPlanWorkspaceLocks } from "@/backend/service/agents/AgentPlanWorkspaceLocks";
import { AgentPlanWorkspaceLockRepository } from "@/backend/database/repositories/agent/AgentPlanWorkspaceLockRepository";
import type { Database } from "@/backend/database/Database";
import type { PlanAgentServices } from "./plan-agent-services.server";
import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import { readableSessionRun } from "./run-diagnosis-services.server";
import type { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import type { AgentSessionRunAccess } from "@/backend/service/agents/sessions/AgentSessionService";
import type { PlanRunEnginePort } from "@/backend/service/agents/runs/PlanRunEnginePort";
import type { AgentApplicationServices } from "./agent-services.server";

/** Provides session access through the initialized plan service. */
export function sessionRunAccess(
  service: () => AgentPlanService,
): AgentSessionRunAccess {
  return {
    run: (userId, id) => service().run(userId, id),
    readableRun: (userId, id) => readableSessionRun(service(), userId, id),
    stop: (userId, id) => service().stop(userId, id),
  };
}

/** Attaches local engine ownership to the runner. */
export function attachRunOwnership(
  runners: AgentApplicationServices["runnerService"],
  engine: PlanRunEnginePort,
): void {
  const localEngine: AgentPlanRunEngine | null =
    engine instanceof AgentPlanRunEngine ? engine : null;
  runners.attachRunOwnership((id) => localEngine?.isActive(id) ?? true);
}

/** Builds the reconciler for workspace reservations. */
export function createPlanWorkspaceLocks(
  input: { readonly database: Database; readonly agents: PlanAgentServices },
  engine: PlanRunEnginePort,
): AgentPlanWorkspaceLocks {
  return new AgentPlanWorkspaceLocks({
    repository: new AgentPlanWorkspaceLockRepository(input.database),
    resources: input.agents.acpResourceScheduler,
    engine,
  });
}
