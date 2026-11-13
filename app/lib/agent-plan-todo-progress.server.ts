import { AgentPlanAgentTodoRepository } from "@/backend/database/repositories/agent/AgentPlanAgentTodoRepository";
import { AgentPlanStepProgressRepository } from "@/backend/database/repositories/agent/AgentPlanStepProgressRepository";
import { AgentPlanStepReportRepository } from "@/backend/database/repositories/agent/AgentPlanStepReportRepository";
import { AgentPlanStepProgressService } from "@/backend/service/agents/AgentPlanStepProgressService";

import type { Database } from "@/backend/database/Database";
import type { AgentTicketChecklistService } from "@/backend/service/agents/AgentTicketChecklistService";

/** Shares persistent TODO state between the plan runner, report validation and plan tools. */
export function createPlanTodoProgress(
  database: Database,
  tickets?: Pick<AgentTicketChecklistService, "read" | "set">,
): AgentPlanStepProgressService {
  return new AgentPlanStepProgressService({
    reports: new AgentPlanStepReportRepository(database),
    progress: new AgentPlanStepProgressRepository(database),
    agentTodos: new AgentPlanAgentTodoRepository(database),
    tickets,
  });
}
