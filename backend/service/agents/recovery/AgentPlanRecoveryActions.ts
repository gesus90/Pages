import { randomUUID } from "node:crypto";

import {
  endTaggedProcesses,
  readScopeSince,
} from "@/backend/agents/cli/CliProcessScan";
import { settleOwnedNamespace } from "@/backend/agents/cli/CliOwnedNamespace";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { isRemoteCloseoutUnconfirmed } from "@/definition/AgentPlanRemoteCloseout";
import { logCaughtError } from "@/backend/logging/Logger";

import { checkSessionProcesses } from "../AgentPlanRecovery";
import { cleanupScanFailure } from "../AgentPlanCleanupFailure";
import { prepareRecoveredPlan } from "../AgentPlanContinuation";
import {
  closeRecoveryScripts,
  closeRecoverySessions,
} from "./AgentPlanRecoveryScripts";
import {
  planResume,
  releaseOption,
  restartOption,
  resumeOption,
  resumedLoopRuns,
} from "./AgentPlanRecoveryPlanning";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type {
  AgentPlanCheckpoint,
  AgentPlanRecoveryCommand,
  AgentPlanRecoveryExecution,
  AgentPlanRecoveryOption,
  AgentPlanRecoveryResult,
  AgentPlanRunOrigin,
} from "@/definition/AgentPlanRecovery";
import type { AgentPlanCheckpointRepository } from "@/backend/database/repositories/agent/AgentPlanCheckpointRepository";
import type { AgentPlanRecoveryExecutionRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryExecutionRepository";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AcpResourceScheduler } from "../AcpResourceScheduler";
import type { AgentPlanAccess } from "../AgentPlanAccess";
import type { AgentPlanPreparation } from "../AgentPlanPreparation";
import type { AgentPlanRemoteExecution } from "../AgentPlanRemoteExecution";
import type { AgentPlanRunEngine } from "../AgentPlanRunEngine";
import type { RecoveredRunStart } from "../AgentPlanRunStart";
import type { AgentPlanService } from "../AgentPlanService";
import type { AgentPlanSnapshot } from "../AgentPlanSnapshot";
import type { RecoveryFacts } from "./AgentPlanRecoveryPlanning";

/** The boundaries of executing recovery; each check stays on the server. */
export interface RecoveryActionDependencies {
  readonly runs: Pick<AgentPlanService, "run">;
  readonly remoteExecution?: Pick<AgentPlanRemoteExecution, "stop">;
  readonly access: Pick<AgentPlanAccess, "require">;
  readonly preparation: Pick<AgentPlanPreparation, "prepare">;
  readonly engine: Pick<AgentPlanRunEngine, "startRecovered"> &
    Partial<Pick<AgentPlanRunEngine, "isActive">>;
  readonly planRuns: Pick<
    AgentPlanRunRepository,
    "latest" | "hasReservation" | "release"
  >;
  readonly executions: AgentPlanRecoveryExecutionRepository;
  readonly checkpoints: Pick<AgentPlanCheckpointRepository, "list" | "append">;
  /** Rechecks the ACP leases of the run; absent without native capacity journal. */
  readonly resources?: Pick<AcpResourceScheduler, "reconcile" | "snapshot">;
}

type RestartCommand = Extract<
  AgentPlanRecoveryCommand,
  { readonly action: "restart" }
>;
type ResumeCommand = Extract<
  AgentPlanRecoveryCommand,
  { readonly action: "resume" }
>;
type ReleaseCommand = Extract<
  AgentPlanRecoveryCommand,
  { readonly action: "release" }
>;

/** The request a decision answers: its validated command and the digest of the original. */
export interface RecoveryRequest<
  Command extends AgentPlanRecoveryCommand = AgentPlanRecoveryCommand,
> {
  readonly userId: string;
  readonly runId: string;
  readonly command: Command;
  readonly requestDigest: string;
}

/** A stored result returned instead of a second start in the same transaction. */
class RecoveryReplayed extends Error {
  public readonly result: AgentPlanRecoveryResult;

  public constructor(result: AgentPlanRecoveryResult) {
    super("Recovery request already answered");
    this.result = result;
  }
}

function requireOption(option: AgentPlanRecoveryOption): void {
  if (option.available) return;
  throw new AgentPlanRecoveryError(
    option.reason === "cleanup_unconfirmed"
      ? "cleanup_unconfirmed"
      : "action_unavailable",
  );
}

/**
 * Reads the server-written snapshot of an ended run.
 *
 * @remarks
 * Pages wrote it when the run started; the check refuses a damaged record
 * instead of continuing from it.
 */
function readStoredSnapshot(input: unknown): AgentPlanSnapshot {
  const snapshot = readAgentObject(input);
  const plan = readAgentObject(snapshot.plan);
  if (
    typeof plan.id !== "string" ||
    !Array.isArray(plan.nodes) ||
    !Array.isArray(plan.edges) ||
    !Array.isArray(snapshot.steps)
  )
    throw new AgentPlanRecoveryError("checkpoint_invalid");
  return input as AgentPlanSnapshot;
}

/** The agent nodes and groups of a frozen plan. */
function frozenNodes(snapshot: AgentPlanSnapshot): {
  readonly agentStepIds: readonly string[];
  readonly groupIds: readonly string[];
} {
  return {
    agentStepIds: snapshot.steps.map((step) => step.step.id),
    groupIds: (snapshot.groups ?? []).map((group) => group.id),
  };
}

/**
 * Restarts a disturbed run from the start, resumes it from its last safe
 * state, or releases what its unproven cleanup still holds.
 *
 * @remarks
 * Every decision is explicit, checked against the current rights of the
 * executor and the run's recovery revision, idempotent by its key and
 * journaled in the transaction that creates the new run. The earlier run
 * is never reopened or rewritten. Nothing starts while a process of the
 * earlier run may still be alive: ownership uses a stored namespace supervisor
 * and, where present, its server-owned worker unit.
 */
export class AgentPlanRecoveryActions {
  private readonly dependencies: RecoveryActionDependencies;

  public constructor(dependencies: RecoveryActionDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads everything a decision about the run depends on.
   *
   * @throws {AgentError} `plan_access_denied` without the executor's current access.
   */
  public async facts(
    userId: string,
    runId: string,
    expectedRevision?: number,
  ): Promise<{
    readonly facts: RecoveryFacts;
    readonly snapshot: AgentPlanSnapshot;
  }> {
    await this.dependencies.runs.run(userId, runId);
    const source = await this.dependencies.executions.source(runId);
    if (source.run.userId !== userId)
      throw new AgentPlanRecoveryError("access_denied");
    if (expectedRevision !== undefined && source.revision !== expectedRevision)
      throw new AgentPlanRecoveryError("revision_conflict");
    const snapshot = readStoredSnapshot(source.snapshot);
    const plan = await this.dependencies.access.require(
      userId,
      source.run.planId,
    );
    const [latest, isReserved, checkpoints, executions] = await Promise.all([
      this.dependencies.planRuns.latest(plan.id),
      this.dependencies.planRuns.hasReservation(runId),
      this.dependencies.checkpoints.list(runId),
      this.dependencies.executions.list(runId),
    ]);
    return {
      snapshot,
      facts: {
        run: source.run,
        isEngineActive: this.dependencies.engine.isActive?.(runId) ?? true,
        plan,
        latest,
        isReserved,
        checkpoints,
        executions,
        ...frozenNodes(snapshot),
      },
    };
  }

  /** Starts the saved revision from the start as a new run; the earlier run stays as it was. */
  public async restart(
    request: RecoveryRequest<RestartCommand>,
  ): Promise<AgentPlanRecoveryResult> {
    const replayed = await this.replayed(request);
    if (replayed) return replayed;
    const { facts } = await this.facts(
      request.userId,
      request.runId,
      request.command.expectedRevision,
    );
    requireOption(restartOption(facts));
    if (facts.plan.revision !== request.command.revision)
      throw new AgentError("plan_conflict");
    await this.settleCleanup(facts);
    const snapshot = await this.dependencies.preparation.prepare(
      request.userId,
      facts.plan,
    );
    return this.start(request, {
      snapshot,
      checkpoints: [],
      recovered: {
        origin: this.origin(facts, {
          kind: "restart",
          mode: null,
          reusedStepIds: [],
          retriedStepIds: [],
          reviewedStepIds: [],
        }),
        reused: [],
        loops: [],
      },
    });
  }

  /**
   * Continues the run from its last safe state as a new, linked run.
   *
   * @throws {AgentPlanRecoveryError} `review_required` while a started node
   * lacks the executor's reviewed decision, `native_resume_unavailable` when
   * an adapter cannot resume its session.
   */
  public async resume(
    request: RecoveryRequest<ResumeCommand>,
  ): Promise<AgentPlanRecoveryResult> {
    const replayed = await this.replayed(request);
    if (replayed) return replayed;
    const { command, userId } = request;
    const { facts, snapshot: previous } = await this.facts(
      userId,
      request.runId,
      command.expectedRevision,
    );
    if (facts.plan.revision !== command.revision)
      throw new AgentError("plan_conflict");
    const plan = planResume(facts);
    requireOption(resumeOption(facts, plan));
    if (command.mode === "live")
      throw new AgentPlanRecoveryError("action_unavailable");
    if (plan.retriedStepIds.some((id) => !command.reviewedStepIds.includes(id)))
      throw new AgentPlanRecoveryError("review_required");
    if (command.mode === "native_resume" && !plan.canResumeNatively)
      throw new AgentPlanRecoveryError("native_resume_unavailable");
    await this.settleCleanup(facts);
    const proposed = await this.dependencies.preparation.prepare(
      userId,
      facts.plan,
    );
    const reusedStepIds = plan.reused.map((step) => step.id);
    const merged = prepareRecoveredPlan(
      boundaryOf(facts, reusedStepIds),
      previous,
      proposed,
    );
    const loops = resumedLoopRuns(facts.run.loops ?? [], reusedStepIds);
    const recovery = {
      sourceRunId: facts.run.id,
      mode: command.mode,
      retriedStepIds: plan.retriedStepIds,
      loopIterations: loops.iterations,
      resumeSessions:
        command.mode === "native_resume" ? plan.resumeSessions : {},
    };
    return this.start(request, {
      snapshot: { ...merged, recovery },
      checkpoints: facts.checkpoints.filter((checkpoint) =>
        reusedStepIds.includes(checkpoint.stepId),
      ),
      recovered: {
        origin: this.origin(facts, {
          kind: "resume",
          mode: command.mode,
          reusedStepIds,
          retriedStepIds: plan.retriedStepIds,
          reviewedStepIds: command.reviewedStepIds,
        }),
        reused: plan.reused,
        loops: loops.loops,
      },
    });
  }

  /**
   * Ends what is left of the run's processes and releases its working copies and leases.
   *
   * @throws {AgentPlanRecoveryError} `cleanup_unconfirmed` while a process of
   * the run is still alive or cannot be ruled out.
   */
  public async release(
    request: RecoveryRequest<ReleaseCommand>,
  ): Promise<AgentPlanRecoveryResult> {
    const replayed = await this.replayed(request);
    if (replayed) return replayed;
    const { facts } = await this.facts(
      request.userId,
      request.runId,
      request.command.expectedRevision,
    );
    requireOption(releaseOption(facts));
    const settled = await this.settleCleanup(facts, false);
    const result: AgentPlanRecoveryResult = {
      commandId: randomUUID(),
      revision: request.command.expectedRevision + 1,
      outcome: "released",
    };
    await this.dependencies.executions.recordAlone(
      {
        command: request.command,
        requestDigest: request.requestDigest,
        result,
        execution: this.execution(request, result, null),
      },
      settled,
    );
    return result;
  }

  private async replayed(
    request: RecoveryRequest,
  ): Promise<AgentPlanRecoveryResult | null> {
    return this.dependencies.executions.replay(
      request.runId,
      request.command,
      request.requestDigest,
    );
  }

  /**
   * Proves that no process of the run is left before anything starts again.
   *
   * @remarks
   * Every unconfirmed session and script must have a settled owned boundary.
   * Only then are working copies and ACP leases released.
   */
  private async settleCleanup(
    facts: RecoveryFacts,
    shouldRelease = true,
  ): Promise<AgentPlanRun> {
    await this.requestRemoteCleanup(facts.run);
    const { run } = await this.dependencies.executions.source(facts.run.id);
    const scope = await readScopeSince(run.startedAt).catch(
      (caughtError: unknown) => {
        logCaughtError("AgentPlanRecoveryActions", caughtError);
        return null;
      },
    );
    await this.endLocalProcesses(run, scope);
    const checked = await closeRecoverySessions(
      await closeRecoveryScripts(run),
    );
    const processes = await checkSessionProcesses(checked);
    if (!processes.confirmed)
      throw new AgentPlanRecoveryError(
        "cleanup_unconfirmed",
        processes.failure ?? undefined,
      );
    await this.reconcileResources(run.id);
    if (shouldRelease) await this.dependencies.executions.releaseChecked(run);
    return run;
  }

  private async reconcileResources(runId: string): Promise<void> {
    const resources = this.dependencies.resources;
    if (!resources) return;
    try {
      const remaining = await resources.reconcile(runId);
      const state = resources.snapshot();
      if (
        remaining > 0 ||
        state.problem !== null ||
        state.active.some((entry) => entry.runId === runId)
      )
        throw new AgentPlanRecoveryError("cleanup_unconfirmed");
    } catch (error: unknown) {
      if (error instanceof AgentPlanRecoveryError) throw error;
      logCaughtError("AgentPlanRecoveryActions", error);
      throw new AgentPlanRecoveryError("cleanup_unconfirmed");
    }
  }

  private async requestRemoteCleanup(run: AgentPlanRun): Promise<void> {
    if (allPlanRunResults(run).some(isRemoteCloseoutUnconfirmed))
      await this.dependencies.remoteExecution?.stop(run);
  }

  private async endLocalProcesses(
    run: AgentPlanRun,
    scope: Awaited<ReturnType<typeof readScopeSince>> | null,
  ): Promise<void> {
    for (const step of allPlanRunResults(run)) {
      if (step.execution?.target.kind === "remote" || step.script) continue;
      const instanceId = step.session?.instanceId;
      const closeout = step.session?.closeout;
      if (instanceId === undefined || closeout === "confirmed") continue;
      const session = step.session;
      const cleanup = await (
        session && session.runner !== "api" && session.namespace
          ? settleOwnedNamespace(session.namespace, instanceId).then(
              (ended) => ({
                remaining: ended ? 0 : 1,
              }),
            )
          : endTaggedProcesses(instanceId, scope)
      ).catch((caughtError: unknown) => {
        logCaughtError("AgentPlanRecoveryActions", caughtError);
        throw new AgentPlanRecoveryError(
          "cleanup_unconfirmed",
          cleanupScanFailure(step.id, "local_session", caughtError),
        );
      });
      if (cleanup.remaining > 0)
        throw new AgentPlanRecoveryError("cleanup_unconfirmed", {
          stepId: step.id,
          kind: "local_session",
          reason: "processes_remaining",
        });
    }
  }

  private async start(
    request: RecoveryRequest<RestartCommand | ResumeCommand>,
    start: {
      readonly snapshot: AgentPlanSnapshot;
      readonly recovered: RecoveredRunStart;
      readonly checkpoints: readonly AgentPlanCheckpoint[];
    },
  ): Promise<AgentPlanRecoveryResult> {
    const { executions, checkpoints } = this.dependencies;
    try {
      const created = await this.dependencies.engine.startRecovered(
        request.userId,
        start.snapshot,
        start.recovered,
        async (transaction, run) => {
          const repeated = await executions.replay(
            request.runId,
            request.command,
            request.requestDigest,
            transaction,
          );
          if (repeated) throw new RecoveryReplayed(repeated);
          const result = startedResult(request, run);
          await executions.record(transaction, {
            command: request.command,
            requestDigest: request.requestDigest,
            result,
            execution: this.execution(request, result, run),
          });
          // The new run carries the completions it took over, so a later resume can verify them.
          for (const checkpoint of start.checkpoints)
            await checkpoints.append(
              transaction,
              { ...checkpoint, runId: run.id },
              0,
            );
        },
      );
      return startedResult(request, created);
    } catch (error: unknown) {
      if (error instanceof RecoveryReplayed) return error.result;
      throw error;
    }
  }

  private origin(
    facts: RecoveryFacts,
    decision: Pick<
      AgentPlanRunOrigin,
      "kind" | "mode" | "reusedStepIds" | "retriedStepIds" | "reviewedStepIds"
    >,
  ): AgentPlanRunOrigin {
    return {
      ...decision,
      runId: facts.run.id,
      checkpointVersion: facts.checkpoints.at(-1)?.version ?? null,
      requestedAt: new Date().toISOString(),
    };
  }

  private execution(
    request: RecoveryRequest,
    result: AgentPlanRecoveryResult,
    run: AgentPlanRun | null,
  ): AgentPlanRecoveryExecution {
    const { action } = request.command;
    if (action !== "restart" && action !== "resume" && action !== "release")
      throw new AgentPlanRecoveryError("action_unavailable");
    return {
      id: result.commandId,
      runId: request.runId,
      userId: request.userId,
      action,
      targetRunId: run?.id ?? null,
      origin: run?.origin ?? null,
      revision: result.revision,
      createdAt: new Date().toISOString(),
    };
  }
}

/** The result of a start; a repeated request gets the same run back. */
function startedResult(
  request: RecoveryRequest<RestartCommand | ResumeCommand>,
  run: AgentPlanRun,
): AgentPlanRecoveryResult {
  return {
    commandId: `${run.id}:${request.command.action}`,
    revision: request.command.expectedRevision + 1,
    outcome: "started",
    runId: run.id,
  };
}

/** The ended run seen as paused at its verified completions, the boundary a continuation checks. */
function boundaryOf(
  facts: RecoveryFacts,
  reusedStepIds: readonly string[],
): AgentPlanRun {
  const groups = facts.run.steps.filter(
    (step) => facts.groupIds.includes(step.id) && step.status === "succeeded",
  );
  const completed = [...reusedStepIds, ...groups.map((step) => step.id)];
  return {
    ...facts.run,
    status: "paused",
    stopRequested: false,
    pauseBoundary: {
      pausedAt: facts.run.endedAt ?? facts.run.startedAt,
      completedStepIds: completed,
      pendingStepIds: facts.run.steps
        .filter((step) => !completed.includes(step.id))
        .map((step) => step.id),
      frontierStepIds: [],
    },
  };
}
