import { AgentError } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AgentPlanCallBlockedError } from "@/backend/error/AgentPlanCallBlockedError";
import { logCaughtError } from "@/backend/logging/Logger";
import { handOverPlanLocks } from "@/backend/database/repositories/agent/AgentPlanHandoverLocks";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { canRunPlan } from "@/definition/AgentPlanTeam";
import { requireManagementScriptExecution } from "@/backend/service/management/ManagementPlanAccess";

import { planWritingWorkspaces } from "../AgentPlanContinuation";

import type {
  AgentPlanInvocationRecord,
  AgentPlanInvocationRepository,
} from "@/backend/database/repositories/agent/AgentPlanInvocationRepository";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanAccess } from "../AgentPlanAccess";
import type { AgentPlanPreparation } from "../AgentPlanPreparation";
import type { AgentPlanRunJournal } from "../AgentPlanJournal";
import type { AgentPlanInvocationContext } from "../AgentPlanSnapshot";
import type { PlanRunEnginePort } from "../runs/PlanRunEnginePort";

/** What a try to create the run of a call came to. */
export type InvocationStart =
  | { readonly kind: "started"; readonly run: AgentPlanRun }
  /** The target plan or a resource it needs is in use; the call stays in the queue. */
  | { readonly kind: "blocked"; readonly owners: readonly string[] }
  /** The call can never start; the code says why. */
  | { readonly kind: "failed"; readonly code: string };

/** What the starter needs from the process that composes the engine. */
export interface InvocationStarterDependencies {
  readonly invocations: Pick<
    AgentPlanInvocationRepository,
    "begin" | "hasActiveRun"
  >;
  readonly access: Pick<AgentPlanAccess, "require">;
  readonly runs: Pick<AgentPlanRunRepository, "find">;
  readonly preparation: Pick<AgentPlanPreparation, "prepare">;
  /** The engine of this process; absent until it is composed. */
  readonly engine: () => Pick<
    PlanRunEnginePort,
    "start" | "isShuttingDown"
  > | null;
}

/** Codes of a refusal that no wait can lift. */
function refusalCode(error: unknown): string | null {
  if (error instanceof AgentError || error instanceof AgentExecutionError)
    return error.code;
  return null;
}

/** Whether the refusal only means that the call has to wait its turn. */
function isTurnWait(code: string | null): boolean {
  return (
    code === "plan_run_unavailable" ||
    code === "plan_jump_start_blocked" ||
    code === "plan_jump_start_conflict"
  );
}

/**
 * The call as the called run needs it.
 * @param record - The stored call.
 */
export function invocationContext(
  record: AgentPlanInvocationRecord,
): AgentPlanInvocationContext {
  return {
    id: record.id,
    entryNodeId: record.entryNodeId,
    sourcePlanId: record.sourcePlanId,
    sourceRunId: record.sourceRunId,
    sourceNodeId: record.sourceNodeId,
    wait: record.wait,
    inputs: record.inputs,
    hasHandover: record.workspace === "shared",
  };
}

/**
 * Creates the run of a call, once, with the rights of the person who runs the caller.
 * @remarks
 * The same checks as for a start by a person apply: the person has to read
 * and run the target plan, its revision has to be the one the call froze, and
 * its resources, workspaces, machines and scripts are authorized again now. The
 * call and the run are stored in one transaction, so a crash can never leave a
 * run without its call or a call that started twice.
 */
export class AgentPlanInvocationStarter {
  private readonly dependencies: InvocationStarterDependencies;

  public constructor(dependencies: InvocationStarterDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Tries to create the run of one call.
   * @param record - A call whose run is still due.
   */
  public async start(
    record: AgentPlanInvocationRecord,
  ): Promise<InvocationStart> {
    const engine = this.dependencies.engine();
    if (!engine || engine.isShuttingDown())
      return { kind: "blocked", owners: [] };
    // A call that went on at once no longer depends on the run that made it.
    if (record.decidedAt === null) {
      const source = await this.dependencies.runs.find(record.sourceRunId);
      if (!source || !isActivePlanRun(source.status) || source.stopRequested)
        return { kind: "failed", code: "plan_jump_cancelled" };
    }
    if (await this.dependencies.invocations.hasActiveRun(record.targetPlanId))
      return { kind: "blocked", owners: [] };
    return this.create(record, engine);
  }

  private async create(
    record: AgentPlanInvocationRecord,
    engine: Pick<PlanRunEnginePort, "start">,
  ): Promise<InvocationStart> {
    try {
      const plan = await this.dependencies.access.require(
        record.userId,
        record.targetPlanId,
      );
      if (!canRunPlan(plan)) throw new AgentError("plan_access_denied");
      requireManagementScriptExecution(
        plan.rights?.canReadAllRuns === true,
        plan,
      );
      if (plan.revision !== record.targetRevision)
        throw new AgentError("plan_jump_interface_changed");
      const snapshot = await this.dependencies.preparation.prepare(
        record.userId,
        plan,
        invocationContext(record),
      );
      const run = await engine.start(
        record.userId,
        snapshot,
        undefined,
        this.journal(record, planWritingWorkspaces(snapshot)),
      );
      return { kind: "started", run };
    } catch (error: unknown) {
      return this.refusal(error);
    }
  }

  /** Stores the call's run in the transaction that creates it, and hands the workspace over with it. */
  private journal(
    record: AgentPlanInvocationRecord,
    resources: readonly string[],
  ): AgentPlanRunJournal {
    return async (transaction, run) => {
      await this.dependencies.invocations.begin(
        transaction,
        record.id,
        run.id,
        new Date().toISOString(),
      );
      if (record.workspace === "shared")
        await handOverPlanLocks(transaction, {
          invocationId: record.id,
          sourceRunId: record.sourceRunId,
          targetRunId: run.id,
          targetKeys: resources,
        });
    };
  }

  private refusal(error: unknown): InvocationStart {
    const code = refusalCode(error);
    if (error instanceof AgentPlanCallBlockedError)
      return { kind: "blocked", owners: error.ownerRunIds };
    if (isTurnWait(code)) return { kind: "blocked", owners: [] };
    if (code !== null) return { kind: "failed", code };
    // An unexpected failure is no reason to give up the call: it stays queued and is tried again.
    logCaughtError("AgentPlanInvocationStarter", error);
    return { kind: "blocked", owners: [] };
  }
}
