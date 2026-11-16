import { AgentPlanSwarmMemoryRepository } from "@/backend/database/repositories/agent/AgentPlanSwarmMemoryRepository";
import { AutomationEventRepository } from "@/backend/database/repositories/automation/AutomationEventRepository";
import { PicaMobileNotificationEventRepository } from "@/backend/database/repositories/mobile/PicaMobileNotificationEventRepository";
import { PicaMobileNotificationPreferenceRepository } from "@/backend/database/repositories/mobile/PicaMobileNotificationPreferenceRepository";
import { PicaMobilePushRegistrationRepository } from "@/backend/database/repositories/mobile/PicaMobilePushRegistrationRepository";
import { AutomationPlanEvents } from "@/backend/service/automation/AutomationPlanEvents";
import { sharedAgentPlanRunObservers } from "@/backend/service/agents/AgentPlanRunObservers";
import { AgentPlanOwnerRunReader } from "@/backend/service/agents/AgentPlanOwnerRunReader";
import { PicaMobileNotificationAccess } from "@/backend/service/mobile/notifications/PicaMobileNotificationAccess";
import { PicaMobileNotificationRecorder } from "@/backend/service/mobile/notifications/PicaMobileNotificationRecorder";
import { SwarmMemoryRunEnd } from "@/backend/service/agents/swarm/SwarmMemoryRunEnd";
import { readPicaMobileNotificationSettings } from "@/backend/service/mobile/notifications/PicaMobileNotificationSettings";
import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";

import type { Database } from "@/backend/database/Database";
import type { PlanDependencies } from "@/backend/service/agents/AgentPlanDependencies";
import type { PagesConfig } from "@/backend/config/PagesConfig";

/**
 * Records durable plan transitions; API/integration workers deliver the resulting work.
 * @remarks
 * It also deletes the swarm memory a finished or cancelled run does not keep.
 */
export function startPlanRunRecorders(
  database: Database,
  dependencies: PlanDependencies,
  config: PagesConfig,
): void {
  const preferences = new PicaMobileNotificationPreferenceRepository(database);
  const observers = sharedAgentPlanRunObservers();
  const detachAutomation = observers.add(
    new AutomationPlanEvents(new AutomationEventRepository(database)),
  );
  const detachNotifications = observers.add(
    new PicaMobileNotificationRecorder({
      registrations: new PicaMobilePushRegistrationRepository(database),
      events: new PicaMobileNotificationEventRepository(database),
      preferences,
      runs: new PicaMobileNotificationAccess(
        new AgentPlanOwnerRunReader(dependencies),
        preferences,
      ),
      replayTtlSeconds:
        readPicaMobileNotificationSettings(config).replayTtlSeconds,
      // Delivery polls durable events in the API or integrations process.
      onRecorded: () => undefined,
    }),
  );
  const detachSwarmMemory = observers.add(
    new SwarmMemoryRunEnd(new AgentPlanSwarmMemoryRepository(database)),
  );
  registerShutdownTask(
    () => {
      detachAutomation();
      detachNotifications();
      detachSwarmMemory();
      return Promise.resolve();
    },
    { step: "plan_run_recorders" },
  );
}
