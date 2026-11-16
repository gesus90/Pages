import path from "node:path";

import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import {
  OpenCodeCredentialStore,
  openCodeCredentials,
} from "@/backend/agents/cli/OpenCodeCredentialStore";
import { requireAgentFiles } from "@/backend/storage/AgentPayloadFileStore";
import { RunnerManagedGitHub } from "@/backend/service/runner/RunnerManagedGitHub";
import { RunnerManagedFiles } from "@/backend/service/runner/RunnerManagedFiles";
import { RunnerManagedAccess } from "@/backend/service/runner/RunnerManagedAccess";
import { RunnerPlanExecution } from "@/backend/service/runner/RunnerPlanExecution";
import { RunnerPlanScripts } from "@/backend/service/runner/RunnerPlanScripts";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { resolveGitHubTokenKey } from "@/backend/github/GitHubTokenKey";
import { authorizeLocalRunnerSource } from "@/backend/service/agents/AgentPlanLocalRunnerAuthorization";
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

import { createPlanTodoProgress } from "./agent-plan-todo-progress.server";

import type { PlanBridgeGrants } from "@/backend/service/agents/bridge/PlanBridgeGrants";
import type { AgentPlanScriptPreparation } from "@/backend/service/agents/AgentPlanScriptPreparation";
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
  local: {
    readonly planAccess: AgentPlanSessionGrants;
    readonly scripts: AgentPlanScriptPreparation;
    readonly bridges: PlanBridgeGrants;
  },
): Promise<{
  remoteTargets: AgentPlanRemoteTargets;
  remoteExecution: AgentPlanRemoteExecution;
  pages: RunnerPagesAccessService;
  execution: RunnerPlanExecution;
  scripts: RunnerPlanScripts;
}> {
  const { remoteTargets, parameters } = createRemoteTargetsAndParameters(input);
  const runtime = await getPagesRuntime();
  const cipher = new InstanceSecretCipher(
    resolveGitHubTokenKey(runtime.getDatabasePath()),
  );
  const connections = new AgentConnectionRepository(input.database);
  const managedFiles = new RunnerManagedFiles({
    runs,
    parameters,
    readBody: (reference) => requireAgentFiles(input.database).read(reference),
    local: input.agents.agentParameterService,
    evidence: new AgentPlanRemoteAccessRepository(input.database),
  });
  const managedGitHub = new RunnerManagedGitHub({
    runs,
    credentials: input.agents.agentCliGitHubCredentials,
    projects: input.agents.agentPlanGitHubCredentials,
  });
  input.agents.runnerService.attachManagedCleanup(async (job) => {
    await managedGitHub.close(job);
    managedFiles.close(job.jobId);
    pages.closeManaged(job);
  });
  const credentialHomes = new AgentCredentialStore(
    path.dirname(runtime.getDatabasePath()),
  );
  const nativeCredentials = new OpenCodeCredentialStore(cipher);
  const managed: RunnerManagedAccess = new RunnerManagedAccess({
    nativeCredentials: async (connectionId) =>
      openCodeCredentials(
        await nativeCredentials.readOwn(
          credentialHomes.paths(connectionId, "opencode"),
        ),
      ),
    github: managedGitHub,
    files: managedFiles,
    readBody: (reference) => requireAgentFiles(input.database).read(reference),
    binary: (job, token, request) => pages.managedBinary(job, token, request),
    uploadTicket: (attemptId, requestParameters, result) =>
      pages.managedUploadTicket(attemptId, requestParameters, result),
    connections,
    cipher,
    runs,
    plans: access,
    bridges: local.bridges,
    api: input.api,
    access: input.agents.agentConnectionAccess,
  });
  const pages: RunnerPagesAccessService = new RunnerPagesAccessService({
    managed,
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
  const { remoteExecution, execution, scripts } =
    await createRemoteExecutionParts(input, {
      access,
      runs,
      local,
      remoteTargets,
      parameters,
      pages,
      cipher,
    });
  return { remoteTargets, remoteExecution, pages, execution, scripts };
}

function createRemoteTargetsAndParameters(input: PlanRemoteServiceInput): {
  readonly remoteTargets: AgentPlanRemoteTargets;
  readonly parameters: AgentPlanRemoteParameters;
} {
  const remoteTargets = new AgentPlanRemoteTargets(
    input.agents.remoteWorkspaceService,
    input.agents.remoteConnectionService,
    input.agents.agentWorkspaceService,
  );
  const parameters = new AgentPlanRemoteParameters({
    targets: remoteTargets,
    tickets: input.agents.agentTicketParameterService,
    content: input.agents.agentContentAccess,
    assets: input.agents.agentTicketAssetService,
    snapshots: input.agents.agentTicketAssetSnapshots,
    authorization: new AuthorizationRepository(input.database),
    users: input.users,
  });
  return { remoteTargets, parameters };
}

async function createRemoteExecutionParts(
  input: PlanRemoteServiceInput,
  context: {
    readonly access: AgentPlanAccess;
    readonly runs: AgentPlanRunRepository;
    readonly local: {
      readonly planAccess: AgentPlanSessionGrants;
      readonly scripts: AgentPlanScriptPreparation;
    };
    readonly remoteTargets: AgentPlanRemoteTargets;
    readonly parameters: AgentPlanRemoteParameters;
    readonly pages: RunnerPagesAccessService;
    readonly cipher: InstanceSecretCipher;
  },
): Promise<{
  readonly remoteExecution: AgentPlanRemoteExecution;
  readonly execution: RunnerPlanExecution;
  readonly scripts: RunnerPlanScripts;
}> {
  const { access, runs, local, remoteTargets, parameters, pages, cipher } =
    context;
  const transport = await createPlanRemoteTransport(
    input,
    { runs, planAccess: local.planAccess },
    pages,
  );
  const planTasks = new AgentPlanTasks(input.tasks, input.users);
  const remoteExecution = new AgentPlanRemoteExecution({
    authorizeLocal: (userId, source) =>
      authorizeLocalRunnerSource(
        {
          plans: access,
          scripts: local.scripts,
          profiles: input.agents.agentProfileService,
          parameters: input.agents.agentParameterService,
        },
        userId,
        source,
      ),
    tasks: planTasks,
    stepReports: new AgentPlanStepReportService(
      new AgentPlanStepReportRepository(input.database),
      planTasks,
      createPlanTodoProgress(input.database),
    ),
    parameters,
    pages: transport.pages,
    targets: remoteTargets,
    access,
    runners: transport.runners,
    provider: transport.provider,
    runs,
  });
  const execution = new RunnerPlanExecution({
    runners: transport.runners,
    runs,
    cipher,
    bridgeUrl: input.mcp.url,
    access: input.agents.agentConnectionAccess,
    saveBody: (planId, body) =>
      requireAgentFiles(input.database).write(planId, body),
    finishLegacy: (runId) =>
      input.agents.localSessions?.finishRun(runId) ?? Promise.resolve(),
  });
  const scripts = new RunnerPlanScripts(
    local.scripts,
    transport.runners,
    runs,
    (run, snapshot, script) =>
      remoteExecution.authorizeScript(run, snapshot, script),
  );
  return { remoteExecution, execution, scripts };
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
