import { ServerCache } from "@/backend/cache/ServerCache";
import { isLocalSessionOwner } from "@/backend/agents/local/LocalSessionMode";
import { POSTGRES_MIGRATIONS } from "@/backend/database/Migrations";
import { isPagesRunsProcess } from "@/backend/runtime/RunsMode";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";
import {
  claimRunApiProcessing,
  claimRunsProcessing,
} from "@/backend/service/agents/runs/RunsProcessing";
import { claimIntegrationProcessing } from "@/backend/service/integrations/IntegrationProcessing";
import { WikiMaintenanceScheduler } from "@/backend/service/wiki/WikiMaintenanceScheduler";

import type { Database } from "@/backend/database/Database";
import type { GitHubJobWorker } from "@/backend/service/integrations/GitHubJobWorker";
import type { WikiService } from "@/backend/service/WikiService";
import type { AgentAssetService } from "@/backend/service/agents/AgentAssetService";
import type { AgentDeletionService } from "@/backend/service/employee/AgentDeletionService";
import type { PagesEventRetention } from "@/backend/service/events/PagesEventRetention";
import type { TaskAttachmentService } from "@/backend/service/task/TaskAttachmentService";

/** Separate writers require fresh authorization and content on both sides of the boundary. */
export async function createServiceCache(): Promise<ServerCache> {
  return (await getPagesRuntime()).getConfig().runsMode === "separate"
    ? ServerCache.disabled()
    : new ServerCache();
}

/** Starts only the background work owned by this process role. */
export async function prepareServiceDatabase(
  database: Database,
): Promise<void> {
  if (isLocalSessionOwner()) return;
  if (!isPagesRunsProcess()) await database.migrate(POSTGRES_MIGRATIONS);
  await claimRunsProcessing((await getPagesRuntime()).getConfig());
  if (isPagesRunsProcess()) return;
  await claimRunApiProcessing((await getPagesRuntime()).getConfig());
  await claimIntegrationProcessing(
    (await getPagesRuntime()).getConfig(),
    "server",
  );
}

/** Starts only the background work owned by this process role. */
export async function startGitHubWorker(
  worker: GitHubJobWorker,
): Promise<void> {
  globalThis.pagesGitHubWorkerStarted ??= worker.start().then(
    () => {
      registerShutdownTask(() => worker.stop(), {
        step: "github_integration_worker",
      });
    },
    (error: unknown) => {
      globalThis.pagesGitHubWorkerStarted = undefined;
      throw error;
    },
  );
  await globalThis.pagesGitHubWorkerStarted;
}

/**
 * Starts the hourly cleanup of the API process: wiki trash, agent assets and
 * the outbox events every reader consumed.
 */
export function startWikiMaintenanceScheduler(
  wikiService: WikiService,
  assets: AgentAssetService,
  events: PagesEventRetention,
  deletions: AgentDeletionService,
): void {
  if (globalThis.pagesWikiMaintenanceStarted) {
    return;
  }

  globalThis.pagesWikiMaintenanceStarted = true;
  const scheduler = new WikiMaintenanceScheduler({
    runMaintenance: async () => {
      await wikiService.runMaintenance();
      await assets.runMaintenance();
      await events.runOnce();
      await deletions.purgeExpired();
    },
  });
  scheduler.start();
  registerShutdownTask(
    async () => {
      scheduler.stop();
    },
    { step: "wiki_maintenance_scheduler" },
  );
}

/**
 * Removes ticket attachment files nothing refers to any more, such as those
 * of projects deleted for good, once when the server starts.
 *
 * @param service - The ticket attachment service.
 */
export async function sweepTicketAttachments(
  service: TaskAttachmentService,
): Promise<void> {
  try {
    if (!isLocalSessionOwner() && !isPagesRunsProcess()) await service.sweep();
  } catch (error: unknown) {
    logCaughtError("services", error);

    logDiagnostic(
      "services",
      "warn",
      "Pages could not sweep ticket attachment files.",
      error,
    );
  }
}
