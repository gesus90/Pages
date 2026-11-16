import path from "node:path";
import { homedir } from "node:os";

import { ConfigFile } from "@/backend/config/ConfigFile";
import { createAgentToolManager } from "@/backend/service/agents/tools/AgentToolServices";
import { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import { AcpResourceRepository } from "@/backend/database/repositories/agent/AcpResourceRepository";
import {
  readAcpResourceLimitSource,
  readAcpResourceOptions,
} from "@/backend/config/AcpResourceConfig";
import { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import { CliLocator } from "@/backend/agents/cli/CliLocator";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { createApiProviderRegistry } from "@/backend/agents/providers/ApiProviderRegistry";
import { AgentCheckService } from "@/backend/service/agents/AgentCheckService";
import { OpenCodeAgentCredentials } from "@/backend/service/agents/OpenCodeAgentCredentials";
import { OpenCodeProviderLinks } from "@/backend/service/agents/OpenCodeProviderLinks";
import { ApiTextExecution } from "@/backend/agents/providers/ApiTextExecution";
import { AgentPlanExecution } from "@/backend/agents/AgentPlanExecution";
import { currentAgentSimulationMode } from "@/backend/agents/simulation/AgentSimulationMode";
import { AgentSimulator } from "@/backend/agents/simulation/AgentSimulator";
import {
  SimulatedPlanExecution,
  simulationGuardedFetch,
} from "@/backend/agents/simulation/SimulatedPlanExecution";
import { ProviderHttpClient } from "@/backend/agents/providers/ProviderHttpClient";
import { PlanAssetReferences } from "@/backend/service/agents/assets/PlanAssetReferences";
import { CliSessionExecution } from "@/backend/agents/cli/CliSessionExecution";
import { antigravityContextBinding } from "@/backend/agents/cli/AntigravityContextBinding";
import { CliWorkerUnits } from "@/backend/agents/cli/CliWorkerUnit";
import { DurableCliSessions } from "@/backend/agents/local/DurableCliSessions";
import {
  isLocalSessionOwner,
  localSessionOwnerDirectory,
} from "@/backend/agents/local/LocalSessionMode";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { AgentPlanGitHubCredentials } from "@/backend/service/agents/AgentPlanGitHubCredentials";
import { CliGitHubCredentials } from "@/backend/agents/cli/CliGitHubCredentials";

import type { AgentCatalogRefresh } from "@/backend/service/agents/AgentCatalogRefresh";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import type { AgentConnectionAccess } from "@/backend/service/agents/AgentConnectionAccess";
import type { LocalSessions } from "@/backend/agents/local/LocalSessions";
import type { AgentGitBridgeSetting } from "@/backend/config/AgentGitBridgeConfig";
import type { AgentToolManagerService } from "@/backend/service/agents/tools/AgentToolManagerService";
import type { AcpResourceOptions } from "@/definition/AcpResource";
import type { AgentTicketAssetDependencies } from "@/backend/service/agents/AgentTicketAssetService";
import type { Database } from "@/backend/database/Database";
import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import type { AgentSimulationMode } from "@/backend/agents/simulation/AgentSimulationMode";
import type {
  AgentApplicationServices,
  AgentServiceResources,
} from "./agent-services.server";

interface ExecutionInput {
  readonly localSessions: LocalSessions | null;
  readonly tools: AgentToolManagerService;
  readonly resources: AcpResourceScheduler | undefined;
  /** Instance folders a CLI agent process must not reach. */
  readonly protectedDirectories: readonly string[];
  /** Operator choice: refuse CLI plan steps where no isolation is possible. */
  readonly isIsolationRequired: boolean;
  /** Private folder of the environment files of limited worker units. */
  readonly workerUnitDirectory: string;
  readonly repository: AgentConnectionRepository;
  readonly cipher: InstanceSecretCipher;
  readonly operations: AgentOperationRegistry;
  readonly runtime: AgentCliRuntime;
  readonly store: AgentCredentialStore;
  readonly locator: CliLocator;
  readonly runner: CliProcessRunner;
  readonly access: AgentConnectionAccess;
  readonly github: CliGitHubCredentials;
  readonly catalog: AgentCatalogRefresh;
  readonly simulation: AgentSimulationMode;
  readonly references: PlanAssetReferences | null;
  readonly ticketAssets: AgentTicketAssetDependencies;
}

/** Wraps the real execution in the simulation while it is on; otherwise returns it unchanged. */
function simulatedExecution(
  real: PlanExecution,
  input: Pick<ExecutionInput, "simulation" | "references" | "ticketAssets">,
): PlanExecution {
  const assets = input.ticketAssets.plans;
  if (!input.simulation.isActive || !assets || !input.references) return real;
  return new SimulatedPlanExecution(
    real,
    new AgentSimulator({
      mode: input.simulation,
      assets,
      references: input.references,
    }),
    input.simulation,
  );
}

/**
 * Builds model execution and checks around the same connection and provider boundaries.
 */
export function createExecutions(
  input: ExecutionInput,
): Pick<
  AgentApplicationServices,
  | "agentPlanExecution"
  | "agentCheckService"
  | "openCodeProviderLinks"
  | "agentSimulation"
  | "agentPlanAssetReferences"
> {
  const { repository, cipher, operations } = input;
  const agentCheckService = new AgentCheckService({
    repository,
    catalog: input.catalog,
    cipher,
    operations,
    cli: input.runtime,
    providers: createApiProviderRegistry(
      new ProviderHttpClient(simulationGuardedFetch(input.simulation)),
    ),
  });
  return {
    agentSimulation: input.simulation,
    agentPlanAssetReferences: input.references,
    agentCheckService,
    openCodeProviderLinks: new OpenCodeProviderLinks({
      connections: repository,
      check: (actor, id) => agentCheckService.run(actor, id, "auth"),
    }),
    agentPlanExecution: createPlanExecution(input),
  };
}

/** Keeps project authorization and temporary CLI credential storage on the server. */
export function createGitHubCredentials(input: {
  readonly database: Database;
  readonly dataDirectory: string;
  readonly tokenKey: Buffer;
  readonly workspaces: AgentWorkspaceService;
  readonly gitBridges?: readonly AgentGitBridgeSetting[];
}): Pick<
  AgentApplicationServices,
  "agentPlanGitHubCredentials" | "agentCliGitHubCredentials"
> {
  return {
    agentPlanGitHubCredentials: new AgentPlanGitHubCredentials({
      projects: new ProjectRepository(input.database),
      workspaces: input.workspaces,
      tokenKey: input.tokenKey,
      gitBridges: input.gitBridges,
    }),
    agentCliGitHubCredentials: new CliGitHubCredentials(input.dataDirectory),
  };
}

/** Creates the managed native adapter dependencies without starting processes or provider checks. */
export function createCliRuntime(input: {
  readonly dataDirectory: string;
  readonly agentsDirectory: string;
  readonly cipher: InstanceSecretCipher;
}): {
  readonly store: AgentCredentialStore;
  readonly locator: CliLocator;
  readonly runner: CliProcessRunner;
  readonly runtime: AgentCliRuntime;
  readonly agentToolManagerService: AgentToolManagerService;
} {
  const { dataDirectory, agentsDirectory, cipher } = input;
  const binding = antigravityContextBinding(process.env);
  const store = binding
    ? new AgentCredentialStore(dataDirectory, undefined, binding)
    : new AgentCredentialStore(dataDirectory);
  const runner = new CliProcessRunner();
  const agentToolManagerService = createAgentToolManager({
    instanceDirectory: path.dirname(agentsDirectory),
    locator: new CliLocator(),
    runner,
  });
  const locator = new CliLocator(undefined, undefined, (binary) =>
    agentToolManagerService.locate(binary),
  );
  const runtime = new AgentCliRuntime({
    store,
    locator,
    runner,
    cipher,
    tools: agentToolManagerService,
  });
  return { store, locator, runner, runtime, agentToolManagerService };
}

/** Applies the same persisted resource limits to all agent execution services. */
export function createAcpResources(
  database: Database,
  resources: AgentServiceResources,
): AcpResourceScheduler {
  return new AcpResourceScheduler({
    store: new AcpResourceRepository(database),
    recoveryScope: resources.recoveryScope,
    readOptions: resourceOptionsReader(resources),
    options: readAcpResourceOptions(resources.acpOptions),
    limitSource: readAcpResourceLimitSource(resources.acpOptions),
  });
}

/**
 * Reads the agent simulation once and builds the references through which
 * runners reach plan assets.
 */
export function createSimulation(
  tokenKey: Buffer,
  ticketAssets: AgentTicketAssetDependencies,
): Pick<ExecutionInput, "simulation" | "references" | "ticketAssets"> {
  const simulation = currentAgentSimulationMode();
  const references = ticketAssets.plans
    ? new PlanAssetReferences(ticketAssets.plans, tokenKey, {
        isDenied:
          simulation.isActive && simulation.scenario === "runner_denied",
      })
    : null;
  return { simulation, references, ticketAssets };
}

function resourceOptionsReader(
  resources: AgentServiceResources,
): (() => Promise<AcpResourceOptions>) | undefined {
  if (
    !resources.configPath ||
    !resources.recoveryScope ||
    resources.recoveryScope === "all"
  )
    return undefined;
  const configFile = new ConfigFile(resources.configPath);
  return async () => {
    const config = await configFile.read();
    if (!config) throw new Error("ACP configuration disappeared");
    return readAcpResourceOptions(config);
  };
}
/** Creates the native adapter without provider catalogs, login services or another resource scheduler. */
export function createDirectCliExecution(
  input: Pick<
    ExecutionInput,
    | "repository"
    | "cipher"
    | "runtime"
    | "store"
    | "locator"
    | "runner"
    | "tools"
    | "resources"
    | "github"
    | "workerUnitDirectory"
    | "protectedDirectories"
    | "isIsolationRequired"
  >,
): CliSessionExecution {
  const cliAdapters = {
    runtime: input.runtime,
    store: input.store,
    locator: input.locator,
    runner: input.runner,
  };
  const apiCredentials = new OpenCodeAgentCredentials(
    input.repository,
    input.cipher,
  );
  return new CliSessionExecution({
    apiCredentials: (connection) => apiCredentials.read(connection),
    ...cliAdapters,
    tools: input.tools,
    resources: isLocalSessionOwner() ? undefined : input.resources,
    github: input.github,
    units: new CliWorkerUnits(
      localSessionOwnerDirectory()
        ? path.join(
            localSessionOwnerDirectory() ?? input.workerUnitDirectory,
            "native-units",
          )
        : input.workerUnitDirectory,
    ),
    isolation: {
      protectedDirectories: input.protectedDirectories,
      isRequired: input.isIsolationRequired,
      readOnlyDirectories: [
        input.tools.directory,
        path.dirname(process.execPath),
        path.join(
          path.dirname(path.dirname(process.execPath)),
          "lib",
          "node_modules",
        ),
      ],
      hiddenDirectories: [homedir()],
    },
  });
}

/** Builds plan execution without allocating connection check, login or catalog services. */
export function createPlanExecution(
  input: Omit<ExecutionInput, "catalog">,
): PlanExecution {
  const { repository, cipher, operations } = input;
  const direct = createDirectCliExecution(input);
  return simulatedExecution(
    new AgentPlanExecution(
      new ApiTextExecution(
        repository,
        cipher,
        simulationGuardedFetch(input.simulation),
      ),
      input.localSessions
        ? new DurableCliSessions(input.localSessions, direct)
        : direct,
      operations,
      input.access,
    ),
    input,
  );
}
