import { CliLocator } from "@/backend/agents/cli/CliLocator";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  readPlanSnapshot,
  planStepDirectory,
} from "@/backend/service/agents/AgentPlanSnapshot";

import { LOCAL_RUNNER_CONNECTION_ID } from "./LocalRunnerIdentity";

import type {
  CliGitHubCredentials,
  CliGitHubAccess,
} from "@/backend/agents/cli/CliGitHubCredentials";
import type { AgentPlanGitHubCredentials } from "@/backend/service/agents/AgentPlanGitHubCredentials";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { RunnerJob } from "@/definition/RunnerProtocol";

interface ManagedGitHubDependencies {
  readonly runs: AgentPlanRunRepository;
  readonly credentials: CliGitHubCredentials;
  readonly projects: AgentPlanGitHubCredentials;
}

/** Ephemeral helper context delivered only to the owned local worker. */
export interface ManagedGitHubContext {
  readonly environment?: Readonly<Record<string, string>>;
  readonly secrets?: readonly string[];
  readonly readOnlyDirectory?: string;
  readonly pathPrefix?: string;
}

/** Keeps the existing repository-scoped Git credentials and operator bridge under runner closeout. */
export class RunnerManagedGitHub {
  private readonly dependencies: ManagedGitHubDependencies;
  private readonly active = new Map<string, Promise<CliGitHubAccess>>();

  public constructor(dependencies: ManagedGitHubDependencies) {
    this.dependencies = dependencies;
  }

  /** Exposes prepared helper paths only to the same-host worker; no token enters a durable command. */
  public async context(job: RunnerJob): Promise<ManagedGitHubContext> {
    if (
      job.execution?.program.kind !== "cli" ||
      job.execution.program.access !== "yolo" ||
      job.execution.program.route.connectionId !== LOCAL_RUNNER_CONNECTION_ID
    )
      return {};
    let pending = this.active.get(job.jobId);
    if (!pending) {
      pending = this.prepare(job);
      this.active.set(job.jobId, pending);
    }
    let prepared: CliGitHubAccess;
    try {
      prepared = await pending;
    } catch (error: unknown) {
      this.active.delete(job.jobId);
      throw error;
    }
    const { PATH: searchPath, ...environment } = prepared.environment;
    return {
      environment,
      secrets: prepared.secrets ?? [],
      readOnlyDirectory: prepared.directory,
      pathPrefix: searchPath?.split(":")[0],
    };
  }

  /** Releases helpers only after the runner has independently confirmed process cleanup. */
  public async close(job: RunnerJob): Promise<void> {
    if (
      job.outcome?.closeout !== "confirmed" &&
      job.cancellation?.closeout !== "confirmed"
    )
      return;
    const pending = this.active.get(job.jobId);
    if (pending) {
      const prepared = await pending;
      await prepared.cleanup();
      this.active.delete(job.jobId);
    }
    await this.dependencies.credentials.cleanupRunner(job.jobId);
  }

  private async prepare(job: RunnerJob): Promise<CliGitHubAccess> {
    const binding = job.plan;
    if (!binding) throw new AgentError("plan_context_changed");
    const run = await this.dependencies.runs.find(binding.runId);
    if (!run) throw new AgentError("plan_run_unavailable");
    const snapshot = readPlanSnapshot(
      await this.dependencies.runs.snapshot(run.id),
    );
    const source = snapshot.steps.find(
      (entry) => entry.step.id === binding.stepId,
    );
    const workspace = source ? planStepDirectory(source) : null;
    if (workspace && workspace.path !== job.execution?.workspace)
      throw new AgentError("plan_context_changed");
    const access = workspace
      ? await this.dependencies.projects.resolve(run.userId, workspace)
      : {
          status: "unavailable" as const,
          reason: "no authorized project connection",
        };
    const bridge =
      workspace && !source?.groupId
        ? await this.dependencies.projects.resolveBridge(
            run.userId,
            workspace,
            { planId: run.planId, stepId: binding.stepId },
          )
        : null;
    const gh =
      access.status === "available"
        ? (await new CliLocator().locate("gh")).path
        : null;
    return this.dependencies.credentials.prepare({
      instanceId: job.jobId,
      runner: true,
      access,
      gh,
      bridge,
      searchPath: process.env.PATH ?? "/usr/bin:/bin",
    });
  }
}
