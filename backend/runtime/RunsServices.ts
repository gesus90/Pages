import path from "node:path";

import { createPlanFoundation } from "@/app/lib/plan-foundation.server";
import { createPlanAgentServices } from "@/app/lib/plan-agent-services.server";
import { createPlanProcessingServices } from "@/app/lib/agent-plan-services.server";
import { startPlanRunRecorders } from "@/app/lib/plan-run-recorders.server";
import { planMcpSettings } from "@/app/lib/bridge-settings.server";
import { Database } from "@/backend/database/Database";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { resolveAgentsDirectory } from "@/backend/config/PagesConfig";
import { resolveGitHubTokenKey } from "@/backend/github/GitHubTokenKey";
import { HealthService } from "@/backend/service/HealthService";
import { interruptedAcpOwners } from "@/backend/service/agents/AgentPlanRecovery";
import { claimRunsProcessing } from "@/backend/service/agents/runs/RunsProcessing";
import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";

import { registerShutdownTask } from "./ProcessLifecycle";
import { getPagesRuntime } from "./PagesRuntime";
import {
  closeDatabaseForShutdown,
  runShutdownSteps,
  SHUTDOWN_LIMITS,
  throwShutdownFailures,
} from "./ShutdownSteps";

import type { PlanAgentServices } from "@/app/lib/plan-agent-services.server";
import type { PlanProcessingServices } from "@/app/lib/agent-plan-services.server";

/** The standalone scheduler owns no HTTP, integration delivery, mobile or chat services. */
export interface RunsServices extends PlanProcessingServices {
  readonly healthService: HealthService;
}

/** Opens the plan runtime after the API has migrated the database; startup inherits no request context. */
export function createRunsServices(): Promise<RunsServices> {
  return withBackgroundDatabaseWork("runs_startup", openRunsServices);
}

async function openRunsServices(): Promise<RunsServices> {
  const runtime = await getPagesRuntime();
  const databaseUrl = runtime.getDatabaseUrl();
  if (!databaseUrl) throw new Error("pages-runs requires PostgreSQL");
  const databasePath = runtime.getDatabasePath();
  const database = await Database.connect(
    databaseUrl,
    path.dirname(databasePath),
  );
  await claimRunsProcessing(runtime.getConfig());
  const tokenKey = resolveGitHubTokenKey(databasePath);
  const foundation = createPlanFoundation({ database, databasePath, tokenKey });
  const agents = createPlanAgentServices(
    database,
    path.dirname(databasePath),
    tokenKey,
    {
      agentsDirectory: resolveAgentsDirectory(runtime.configFile.path),
      configPath: runtime.configFile.path,
      recoveryScope: "plans",
      acpOptions: runtime.getConfig(),
      gitBridges: runtime.getConfig().agentGitBridges,
      ticketAssets: foundation.ticketAssets,
      events: foundation.events,
    },
  );
  await recoverPlanAgents(database, agents);
  const services = await createPlanProcessingServices({
    database,
    agents,
    tasks: foundation.tasks,
    users: foundation.users,
    mcp: planMcpSettings(runtime.getConfig().port),
    beforeRecovery: (dependencies) =>
      startPlanRunRecorders(database, dependencies, runtime.getConfig()),
    // The engine uses RunApiPages. A process-local API capability would break that boundary.
    api: () =>
      Promise.reject(new Error("The Agent API belongs to the API process")),
  });
  registerShutdownTask(
    async () => {
      agents.localSessions?.detachAll();
      const failures = await runShutdownSteps([
        { step: "plans", work: () => services.agentPlanService.shutdown() },
        {
          step: "acp_resources",
          work: () => agents.acpResourceScheduler.shutdown(),
        },
        {
          step: "tool_manager",
          work: () => agents.agentToolManagerService.shutdown(),
        },
        { step: "plan_agent_clients", work: () => agents.closeClients() },
      ]);
      const closeFailure = await closeDatabaseForShutdown(() =>
        database.close(),
      );
      throwShutdownFailures(
        closeFailure ? [...failures, closeFailure] : failures,
      );
    },
    { step: "runs_services", budgetMs: SHUTDOWN_LIMITS.deadlineMs },
  );
  return { ...services, healthService: new HealthService(database) };
}

async function recoverPlanAgents(
  database: Database,
  agents: PlanAgentServices,
): Promise<void> {
  const discovered = await agents.localSessions?.discover();
  const leftovers = await agents.agentCliGitHubCredentials.recover(
    discovered?.adopted,
    discovered?.uncertain,
  );
  const runs = new AgentPlanRunRepository(database);
  const interrupted = await Promise.all([runs.unfinished(), runs.reserving()]);
  await agents.acpResourceScheduler.recover(
    interruptedAcpOwners(interrupted.flat(), discovered?.adopted),
    new Set(leftovers.map((entry) => entry.instanceId)),
    discovered?.adopted,
    discovered?.uncertain,
  );
  await agents.localSessions?.settleFinished();
}
