import { upgradePlanConfigurations } from "@/backend/service/agents/AgentPlanConfigurationUpgrade";
import { shareLegacyPlans } from "@/backend/service/agents/AgentPlanLegacyShare";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";

import type { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import type { Database } from "@/backend/database/Database";

/**
 * Brings the plans stored by an earlier version up to date when the server starts.
 *
 * @remarks
 * Legacy node configurations are pinned, and the plans of before teams are
 * shared once with the team of their owner; the second step never throws.
 */
export async function upgradeStoredPlans(
  database: Database,
  plans: AgentPlanRepository,
): Promise<void> {
  await upgradePlanConfigurations({
    plans,
    profiles: new AgentProfileRepository(database),
    connections: new AgentConnectionRepository(database),
  });
  await shareLegacyPlans({
    plans,
    authorization: new AuthorizationRepository(database),
  });
}
