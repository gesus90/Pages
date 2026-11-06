import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
import {
  closeDatabaseForShutdown,
  runShutdownSteps,
  SHUTDOWN_LIMITS,
  throwShutdownFailures,
} from "@/backend/runtime/ShutdownSteps";

import type { Database } from "@/backend/database/Database";
import type { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import type { AgentApplicationServices } from "./agent-services.server";

/**
 * Detaches durable native work and closes PostgreSQL after transient requests have drained.
 *
 * @param database - Central database access to close on shutdown.
 * @param agents - The agent services, which stop before it.
 * @param plans - The plan service, which detaches proven durable local runs and drains other work.
 *
 * @remarks
 * The steps keep their order but do not depend on each other (PAGE-199): a
 * failing or stuck step is reported under its name, and every later step and
 * the attempt to close the database still run.
 */
export function registerShutdownHandler(
  database: Database,
  agents: AgentApplicationServices,
  plans: AgentPlanService,
): void {
  if (globalThis.pagesShutdownHandlerRegistered) {
    return;
  }

  globalThis.pagesShutdownHandlerRegistered = true;

  const shutdown = async (): Promise<void> => {
    agents.localSessions?.detachAll();
    const failures = await runShutdownSteps([
      { step: "chat_requests", work: () => agents.chatRequests.shutdown() },
      { step: "plans", work: () => plans.shutdown() },
      {
        step: "acp_resources",
        work: () => agents.acpResourceScheduler.shutdown(),
      },
      {
        step: "catalog_scheduler",
        work: () => agents.agentCatalogScheduler.shutdown(),
      },
      {
        step: "tool_manager",
        work: () => agents.agentToolManagerService.shutdown(),
      },
      {
        step: "tool_startup",
        work: () => agents.agentToolStartupService.shutdown(),
      },
      { step: "cli_login", work: () => agents.agentCliLoginService.shutdown() },
      {
        step: "remote_console",
        work: async () => {
          agents.remoteConsoleService.shutdown();
        },
      },
      { step: "remote_sessions", work: () => agents.remoteSessions.shutdown() },
      { step: "ssh_client", work: () => agents.sshClient.dispose() },
    ]);
    const closeFailure = await closeDatabaseForShutdown(() => database.close());
    throwShutdownFailures(
      closeFailure === null ? failures : [...failures, closeFailure],
    );
  };

  registerShutdownTask(shutdown, {
    step: "services",
    // Its steps are bounded themselves, and the close has a budget of its own.
    budgetMs: SHUTDOWN_LIMITS.deadlineMs,
  });
}
