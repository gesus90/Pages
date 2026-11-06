import { isLocalSessionOwner } from "@/backend/agents/local/LocalSessionMode";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { AgentPlanRemoteAccessRepository } from "@/backend/database/repositories/agent/AgentPlanRemoteAccessRepository";
import { AgentPlanStepReportRepository } from "@/backend/database/repositories/agent/AgentPlanStepReportRepository";
import { RunApiCleanupRepository } from "@/backend/database/repositories/agent/RunApiCleanupRepository";
import { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { isPagesRunsProcess } from "@/backend/runtime/RunsMode";
import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
import { AgentPlanRemoteExecution } from "@/backend/service/agents/AgentPlanRemoteExecution";
import { AgentPlanRemoteParameters } from "@/backend/service/agents/AgentPlanRemoteParameters";
import { AgentPlanRemoteTargets } from "@/backend/service/agents/AgentPlanRemoteTargets";
import { AgentPlanTasks } from "@/backend/service/agents/AgentPlanTasks";
import { AgentPlanStepReportService } from "@/backend/service/agents/AgentPlanStepReportService";
import {
  RunApiBridge,
  runApiSocketPath,
} from "@/backend/service/agents/runs/RunApiBridge";
import { RunApiClient } from "@/backend/service/agents/runs/RunApiClient";
import { RunApiPages } from "@/backend/service/agents/runs/RunApiPages";
import { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import { RunnerPagesAccessService } from "@/backend/service/runner/RunnerPagesAccessService";

import type { AgentPlanAccess } from "@/backend/service/agents/AgentPlanAccess";
import type { AgentPlanSessionGrants } from "@/backend/service/agents/AgentPlanSessionAccess";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type {
  AgentPlanServices,
  createAgentPlanService,
} from "./agent-plan-services.server";
import type { RunnerService } from "@/backend/service/runner/RunnerService";
import type { RunnerOpenRouterService } from "@/backend/service/runner/RunnerOpenRouterService";

type PlanRemoteServiceInput = Parameters<typeof createAgentPlanService>[0];
interface PlanRemoteTransport {
  readonly runners: RunnerService | RunApiClient;
  readonly provider: Pick<RunnerOpenRouterService, "catalog">;
  readonly pages: Pick<
    AgentPlanServices["runnerPagesAccessService"],
    "open" | "close"
  >;
}

/** Builds remote preparation around the API-owned channel boundary in separate mode. */
export async function createPlanRemoteServices(
  input: PlanRemoteServiceInput,
  access: AgentPlanAccess,
  runs: AgentPlanRunRepository,
  planAccess: AgentPlanSessionGrants,
): Promise<{
  remoteTargets: AgentPlanRemoteTargets;
  remoteExecution: AgentPlanRemoteExecution;
  pages: RunnerPagesAccessService;
}> {
  const remoteTargets = new AgentPlanRemoteTargets(
    input.agents.remoteWorkspaceService,
    input.agents.remoteConnectionService,
  );
  const parameters = new AgentPlanRemoteParameters({
    targets: remoteTargets,
    tickets: input.agents.agentTicketParameterService,
    content: input.agents.agentContentAccess,
    assets: input.agents.agentTicketAssetService,
    authorization: new AuthorizationRepository(input.database),
    users: input.users,
  });
  const pages = new RunnerPagesAccessService({
    parameters,
    runs,
    plans: access,
    runners: input.agents.runnerService,
    credentials: new AgentRunCredentialService(
      new AgentRunCredentialRepository(input.database),
    ),
    evidence: new AgentPlanRemoteAccessRepository(input.database),
    api: input.api,
  });
  const transport = await createPlanRemoteTransport(
    input,
    { runs, planAccess },
    pages,
  );
  const planTasks = new AgentPlanTasks(input.tasks, input.users);
  const remoteExecution = new AgentPlanRemoteExecution({
    tasks: planTasks,
    stepReports: new AgentPlanStepReportService(
      new AgentPlanStepReportRepository(input.database),
      planTasks,
    ),
    parameters,
    pages: transport.pages,
    targets: remoteTargets,
    access,
    runners: transport.runners,
    provider: transport.provider,
    runs,
  });
  return { remoteTargets, remoteExecution, pages };
}

async function createPlanRemoteTransport(
  input: PlanRemoteServiceInput,
  local: {
    readonly runs: AgentPlanRunRepository;
    readonly planAccess: AgentPlanSessionGrants;
  },
  pages: RunnerPagesAccessService,
): Promise<PlanRemoteTransport> {
  const runtime = await getPagesRuntime();
  const config = runtime.getConfig();
  const runners = input.agents.runnerService;
  const provider = input.agents.runnerOpenRouterService;
  const cleanup = new RunApiCleanupRepository(input.database);
  if (isPagesRunsProcess()) {
    const client = new RunApiClient(
      runApiSocketPath(runtime.getDatabasePath()),
      runners,
    );
    return {
      runners: client,
      provider: {
        catalog: (userId, connectionId) =>
          client.providerCatalog(userId, connectionId),
      },
      pages: new RunApiPages(client, cleanup),
    };
  }
  if (
    !isLocalSessionOwner() &&
    !config.firstRun &&
    config.runsMode === "separate" &&
    config.databaseUrl
  ) {
    const bridge = new RunApiBridge(
      {
        runners,
        provider,
        pages,
        runs: local.runs,
        cleanup,
        planAccess: local.planAccess,
      },
      {
        databasePath: runtime.getDatabasePath(),
      },
    );
    await bridge.start();
    registerShutdownTask(() => bridge.close(), { step: "run_api_bridge" });
  } else if (!isLocalSessionOwner()) await pages.recover();
  return { runners, provider, pages };
}
