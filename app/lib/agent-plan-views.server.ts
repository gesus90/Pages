import { AgentPlanCommandOperations } from "@/backend/service/agents/AgentPlanCommandOperations";
import { AgentPlanSwarmMemoryRepository } from "@/backend/database/repositories/agent/AgentPlanSwarmMemoryRepository";
import { AgentPlanTemplateRepository } from "@/backend/database/repositories/agent/AgentPlanTemplateRepository";
import { AgentPlanActiveRunService } from "@/backend/service/agents/AgentPlanActiveRuns";
import { AgentPlanOverviewService } from "@/backend/service/agents/AgentPlanOverview";
import { AgentPlanRunHistoryService } from "@/backend/service/agents/AgentPlanRunHistoryService";
import { AgentPlanOwnerRunReader } from "@/backend/service/agents/AgentPlanOwnerRunReader";
import { AgentPlanManagement } from "@/backend/service/agents/AgentPlanManagement";
import { AgentPlanTemplateService } from "@/backend/service/agents/AgentPlanTemplateService";
import { AgentPlanSwarmMemoryService } from "@/backend/service/agents/swarm/AgentPlanSwarmMemoryService";

import { createPicaMobileNotificationServices } from "./pica-mobile-notification-services.server";

import type { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import type { Database } from "@/backend/database/Database";
import type { PlanDependencies } from "@/backend/service/agents/AgentPlanService";
import type {
  createAgentPlanService,
  AgentPlanServices,
} from "./agent-plan-services.server";

/** The services that read, list or announce plans and runs through the plan service. */
export async function createPlanViews(
  input: Parameters<typeof createAgentPlanService>[0],
  dependencies: PlanDependencies,
  service: AgentPlanService,
): Promise<
  Pick<
    AgentPlanServices,
    | "agentPlanActiveRunService"
    | "agentPlanOverviewService"
    | "agentPlanRunHistoryService"
    | "picaMobileNotifications"
    | "picaMobileAutomationPush"
    | "agentPlanCommands"
    | "agentPlanManagement"
    | "agentPlanTemplateService"
    | "agentPlanSwarmMemoryService"
  >
> {
  return {
    agentPlanActiveRunService: new AgentPlanActiveRunService(
      dependencies,
      service,
    ),
    agentPlanOverviewService: new AgentPlanOverviewService(
      dependencies,
      service,
    ),
    agentPlanRunHistoryService: new AgentPlanRunHistoryService(dependencies),
    ...(await createPicaMobileNotificationServices({
      database: input.database,
      users: input.users,
      ownerRuns: new AgentPlanOwnerRunReader(dependencies),
    })),
    ...createPlanManagement(input.database, service),
    agentPlanSwarmMemoryService: new AgentPlanSwarmMemoryService({
      runs: service,
      memories: new AgentPlanSwarmMemoryRepository(input.database),
    }),
  };
}

function createPlanManagement(
  database: Database,
  service: AgentPlanService,
): Pick<
  AgentPlanServices,
  "agentPlanCommands" | "agentPlanManagement" | "agentPlanTemplateService"
> {
  const templates = new AgentPlanTemplateService({
    templates: new AgentPlanTemplateRepository(database),
    plans: service,
  });
  return {
    agentPlanCommands: new AgentPlanCommandOperations({
      database,
      plans: service,
      templates,
    }),
    agentPlanManagement: new AgentPlanManagement({ database, plans: service }),
    agentPlanTemplateService: templates,
  };
}
