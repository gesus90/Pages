import {
  remoteCliModels,
  remoteOpenRouterModels,
} from "./AgentPlanRemoteCatalog";

import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type { AgentPlanInterpreter } from "@/definition/AgentPlanScript";
import type { AgentPlanRemoteStatus } from "@/definition/AgentPlanTarget";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { RunnerService } from "@/backend/service/runner/RunnerService";
import type { RunnerOpenRouterService } from "@/backend/service/runner/RunnerOpenRouterService";
import type { AgentPlanRemoteTargets } from "./AgentPlanRemoteTargets";

interface SourceDependencies {
  readonly runners: RunnerService;
  readonly provider: RunnerOpenRouterService;
  readonly targets: AgentPlanRemoteTargets;
}

interface RemoteSources {
  readonly models: readonly PageAgentModel[];
  readonly interpreters: readonly AgentPlanInterpreter[];
  readonly statuses: readonly AgentPlanRemoteStatus[];
}

/** The editor and preparation read the same retained inventory and live start blockers. */
export class AgentPlanRemoteSources {
  private readonly dependencies: SourceDependencies;

  public constructor(dependencies: SourceDependencies) {
    this.dependencies = dependencies;
  }

  /** Keeps workspace identities separate even when several targets share one runner catalog. */
  public async read(userId: string, projectId: string): Promise<RemoteSources> {
    const targets = await this.dependencies.targets.list(userId, projectId);
    const choices = await this.dependencies.targets.choices(userId);
    const sources = await Promise.all(
      targets.map((target) =>
        this.target(
          userId,
          target,
          choices.some(
            (entry) =>
              entry.workspaceId === target.workspaceId && entry.isUsable,
          ),
        ),
      ),
    );
    return {
      models: sources.flatMap((source) => source.models),
      interpreters: sources.flatMap((source) => source.interpreters),
      statuses: sources.flatMap((source) => source.statuses),
    };
  }

  private async target(
    userId: string,
    target: AgentPlanRemoteTarget,
    isWorkspaceUsable: boolean,
  ): Promise<RemoteSources> {
    const { runners } = this.dependencies;
    const problem =
      (await runners.availability(target.connectionId)) ??
      (isWorkspaceUsable ? null : "remoteWorkspace");
    const catalog = await runners.catalog(target.connectionId);
    const programs = catalog?.interpreters ?? [];
    const removed = catalog?.removedInterpreterIds ?? [];
    const status: AgentPlanRemoteStatus = {
      workspaceId: target.workspaceId,
      problem,
      tools: catalog?.tools ?? [],
      hasModelCatalog: false,
      isToolCatalogCurrent: catalog?.areToolsComplete === true,
      hasPagesAccess: runners.supportsPagesAccess(target.connectionId),
      hasOpenCodeAccess: runners.supportsOpenCode(target.connectionId),
      catalogCheckedAt: catalog?.checkedAt,
      interpreterIds: programs
        .filter((program) => !removed.includes(program.id))
        .map((program) => `${target.workspaceId}-${program.id}`),
      removedInterpreterIds: removed.map((id) => `${target.workspaceId}-${id}`),
    };
    const interpreters = programs.map((program): AgentPlanInterpreter => ({
      id: `${target.workspaceId}-${program.id}`,
      name: `${target.connectionName} / ${target.workspaceName} / ${program.name}`,
      runnerWorkspaceId: target.workspaceId,
      status: profileStatus(removed.includes(program.id), problem),
      version: program.version,
      error: removed.includes(program.id) ? "missing" : null,
      remoteState: profileState(removed.includes(program.id), problem),
    }));
    if (problem) return { models: [], interpreters, statuses: [status] };
    const models = remoteCliModels(
      target,
      status.tools,
      status.hasOpenCodeAccess,
    );
    const provider = await this.provider(userId, target, status);
    return {
      models: [...models, ...provider.models],
      interpreters,
      statuses: [provider.status],
    };
  }

  private async provider(
    userId: string,
    target: AgentPlanRemoteTarget,
    status: AgentPlanRemoteStatus,
  ): Promise<{
    readonly status: AgentPlanRemoteStatus;
    readonly models: readonly PageAgentModel[];
  }> {
    try {
      const catalog = await this.dependencies.provider.catalog(
        userId,
        target.connectionId,
      );
      if (catalog.operation !== "catalog") return { status, models: [] };
      return {
        status: {
          ...status,
          hasModelCatalog: catalog.freeModels.length > 0,
          modelIds: catalog.freeModels.map((model) => model.id),
          catalogRevision: catalog.syncedAt,
        },
        models: remoteOpenRouterModels(target, catalog),
      };
    } catch {
      return { status, models: [] };
    }
  }
}

function profileStatus(
  isRemoved: boolean,
  problem: AgentPlanRemoteStatus["problem"],
): AgentPlanInterpreter["status"] {
  if (isRemoved) return "error";
  return problem ? "unchecked" : "ok";
}

function profileState(
  isRemoved: boolean,
  problem: AgentPlanRemoteStatus["problem"],
): AgentPlanInterpreter["remoteState"] {
  if (isRemoved) return "removed";
  if (problem === "remoteRunnerUpdate") return "incompatible";
  if (problem === "remoteCatalogStale") return "stale";
  return problem ? "unreachable" : "current";
}
