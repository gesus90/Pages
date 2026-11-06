import path from "node:path";

import { isLocalSessionOwner } from "@/backend/agents/local/LocalSessionMode";
import { isPagesRunsProcess, canProcessRuns } from "@/backend/runtime/RunsMode";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { interruptedAcpOwners } from "@/backend/service/agents/AgentPlanRecovery";
import { AgentAssetRepository } from "@/backend/database/repositories/agents/AgentAssetRepository";
import { AgentAssetService } from "@/backend/service/agents/AgentAssetService";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";
import { resolveAgentsDirectory } from "@/backend/config/PagesConfig";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";

import { createAgentServices } from "./agent-services.server";

import type { AcpRecoveryScope } from "@/backend/service/agents/resources/AcpLeaseAdmission";
import type { Database } from "@/backend/database/Database";
import type { TaskAttachmentService } from "@/backend/service/task/TaskAttachmentService";
import type { WikiService } from "@/backend/service/WikiService";
import type { AgentTicketAssetDependencies } from "@/backend/service/agents/AgentTicketAssetService";
import type { AgentApplicationServices } from "./agent-services.server";

/** Wires ticket asset readers before starting the shared agent runtimes. */
export async function startExecutionServices(
  database: Database,
  databasePath: string,
  context: {
    readonly tokenKey: Buffer;
    readonly tickets: TaskAttachmentService;
    readonly wiki: WikiService;
  },
): Promise<{
  readonly agentServices: AgentApplicationServices;
}> {
  const agentServices = await startAgents(
    database,
    databasePath,
    context.tokenKey,
    ticketAssetDependencies(
      database,
      databasePath,
      context.tickets,
      context.wiki,
    ),
  );
  return { agentServices };
}

function ticketAssetDependencies(
  database: Database,
  databasePath: string,
  tickets: TaskAttachmentService,
  wiki: WikiService,
): AgentTicketAssetDependencies {
  return {
    tickets,
    wiki,
    assets: new AgentAssetService({
      repository: new AgentAssetRepository(database),
      files: new WikiFileStore(
        path.join(path.dirname(databasePath), "agent-assets"),
      ),
      wiki,
    }),
  };
}

/**
 * The agent folders lie next to the configuration file, apart from the data directory.
 *
 * @remarks
 * Credential leftovers are cleaned up first, so a session whose leftover
 * stays unconfirmed keeps its capacity without another scan.
 */
async function startAgents(
  database: Database,
  databasePath: string,
  tokenKey: Buffer,
  ticketAssets: AgentTicketAssetDependencies,
): Promise<AgentApplicationServices> {
  const runtime = await getPagesRuntime();
  const services = createAgentServices(
    database,
    path.dirname(databasePath),
    tokenKey,
    {
      agentsDirectory: resolveAgentsDirectory(runtime.configFile.path),
      configPath: runtime.configFile.path,
      recoveryScope: agentRecoveryScope(runtime.getConfig().runsMode),
      ticketAssets,
      acpOptions: runtime.getConfig(),
      gitBridges: runtime.getConfig().agentGitBridges,
    },
  );
  if (!canProcessRuns()) {
    if (!isLocalSessionOwner()) await services.acpResourceScheduler.recover();
    return services;
  }
  const discovered = await services.localSessions?.discover();
  const leftovers = await services.agentCliGitHubCredentials.recover(
    discovered?.adopted,
    discovered?.uncertain,
  );
  const runs = new AgentPlanRunRepository(database);
  const interrupted = await Promise.all([runs.unfinished(), runs.reserving()]);
  await services.acpResourceScheduler.recover(
    interruptedAcpOwners(interrupted.flat(), discovered?.adopted),
    new Set(leftovers.map((leftover) => leftover.instanceId)),
    discovered?.adopted,
    discovered?.uncertain,
  );
  await services.localSessions?.settleFinished();
  void services.agentToolStartupService.start().catch(() => {
    console.warn(
      "[pages] Agent tool startup checks could not finish; other Pages functions remain available.",
    );
  });
  services.agentCatalogScheduler.start();
  return services;
}

function agentRecoveryScope(
  mode: "server" | "separate" | undefined,
): AcpRecoveryScope {
  if (mode !== "separate") return "all";
  return isPagesRunsProcess() ? "plans" : "chat";
}
