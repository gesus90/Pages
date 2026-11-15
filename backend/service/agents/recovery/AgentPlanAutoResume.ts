import { setTimeout as wait } from "node:timers/promises";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import {
  logCaughtError,
  logEvent,
  withLogContext,
} from "@/backend/logging/Logger";

import { planFailureStop } from "../AgentPlanBlockerRules";
import {
  canResumeAfterRestart,
  decideAutomaticRestart,
  decideRestartSessionMode,
} from "../AgentPlanStepDecision";
import { planResume, resumeOption } from "./AgentPlanRecoveryPlanning";

import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanRecoveryCommand } from "@/definition/AgentPlanRecovery";
import type { AgentPlanRunEngine } from "../AgentPlanRunEngine";
import type { AgentPlanRecoveryActions } from "./AgentPlanRecoveryActions";
import type { AgentPlanRecoveryService } from "./AgentPlanRecoveryService";
import type { RecoveryFacts, ResumePlan } from "./AgentPlanRecoveryPlanning";

type ResumeCommand = Extract<
  AgentPlanRecoveryCommand,
  { readonly action: "resume" }
>;

/** The command of an automatic continuation, or why none may start. */
export type AgentPlanAutomaticResumeDecision = ResumeCommand | string;

interface AutoResumeDependencies {
  readonly runs: Pick<
    AgentPlanRunRepository,
    "pendingAutomaticResumes" | "find" | "update"
  >;
  readonly recovery: Pick<AgentPlanRecoveryService, "automaticResume">;
  readonly engine: Pick<AgentPlanRunEngine, "isShuttingDown">;
}

/**
 * How the retried work of a run may continue, or why it may not.
 *
 * @remarks
 * Only a native session keeps what an agent did. A new session is safe only
 * where no tool ran. A script or a loop cannot prove either, because their
 * effects cannot be reconciled and a loop's sessions always start new.
 */
function resumeMode(
  facts: RecoveryFacts,
  plan: ResumePlan,
): NonNullable<ResumeCommand["mode"]> | string {
  const retried = facts.run.steps.filter((step) =>
    plan.retriedStepIds.includes(step.id),
  );
  if (retried.some((step) => step.script !== undefined))
    return "script_started";
  if (retried.some((step) => facts.run.loops?.some(({ id }) => id === step.id)))
    return "loop_session";
  return decideRestartSessionMode(
    retried.map((step) => step.session),
    retried.length > 0 &&
      retried.every((step) =>
        Boolean(plan.resumeSessions[step.groupId ?? step.id]),
      ),
  );
}

/**
 * Decides on the current facts whether the run continues, and how.
 *
 * @param facts - The rights-checked facts of the interrupted run.
 * @param revision - The recovery revision of the run.
 * @param attempt - Which automatic continuation this is.
 * @returns The resume command, or the reason nothing starts.
 *
 * @remarks
 * Whatever is not a pure interruption stays with a person: another failure of
 * the run, a plan that changed since its start, and every option a resume would
 * refuse anyway.
 */
export function automaticResumeDecision(
  facts: RecoveryFacts,
  revision: number,
  attempt: number,
): AgentPlanAutomaticResumeDecision {
  if (!facts.run.steps.every(canResumeAfterRestart)) return "failure_class";
  if (facts.plan.revision !== facts.run.planRevision) return "plan_changed";
  const plan = planResume(facts);
  const option = resumeOption(facts, plan);
  if (!option.available) return option.reason ?? "action_unavailable";
  const mode = resumeMode(facts, plan);
  if (mode !== "native_resume" && mode !== "new_session") return mode;
  return {
    action: "resume",
    mode,
    revision: facts.plan.revision,
    reviewedStepIds: plan.retriedStepIds,
    expectedRevision: revision,
    idempotencyKey: `automatic-resume:${facts.run.id}:${attempt}`,
  };
}

function failureCode(error: unknown): string {
  if (error instanceof AgentPlanRecoveryError || error instanceof AgentError)
    return error.code;
  return "plan_step_failed";
}

/**
 * Continues runs a server restart interrupted, at most three times per chain of runs (PAGE-210).
 *
 * @remarks
 * Only runs this version recorded as interrupted are taken up, so the runs
 * interrupted long ago never start by themselves. The count travels in the
 * origin of each new run, so a further restart cannot reset it, and the wait is
 * repeated after a restart during it. Everything else uses the checks of an
 * explicit resume.
 */
export class AgentPlanAutoResume {
  private readonly dependencies: AutoResumeDependencies;

  public constructor(dependencies: AutoResumeDependencies) {
    this.dependencies = dependencies;
  }

  /** Takes up every pending run; it never throws, and a run that fails does not touch the others. */
  public async start(): Promise<void> {
    try {
      const runs = await this.dependencies.runs.pendingAutomaticResumes();
      await Promise.all(runs.map((run) => this.resume(run)));
    } catch (error: unknown) {
      logCaughtError("AgentPlanAutoResume", error);
    }
  }

  private async resume(run: AgentPlanRun): Promise<void> {
    const attempt = (run.origin?.automaticAttempt ?? 0) + 1;
    try {
      const restart = decideAutomaticRestart(attempt);
      if (restart.kind === "exhausted") {
        await this.record(run, "stopped", "exhausted");
        return;
      }
      await wait(restart.delayMilliseconds, undefined, { ref: false });
      // A run still waiting at a stop stays pending for the next start.
      if (this.dependencies.engine.isShuttingDown()) return;
      const result = await this.dependencies.recovery.automaticResume(
        async (actions: AgentPlanRecoveryActions) => {
          const { facts } = await actions.facts(run.userId, run.id);
          const { revision } = await actions.sourceRevision(run.id);
          return automaticResumeDecision(facts, revision, attempt);
        },
        { userId: run.userId, runId: run.id, automaticAttempt: attempt },
      );
      if (typeof result === "string") await this.record(run, "stopped", result);
      else await this.record(run, "started");
    } catch (error: unknown) {
      if (this.dependencies.engine.isShuttingDown()) return;
      logCaughtError("AgentPlanAutoResume", error);
      await this.record(run, "stopped", failureCode(error)).catch(
        (recordError: unknown) => {
          logCaughtError("AgentPlanAutoResume", recordError);
        },
      );
    }
  }

  /** Keeps the outcome on the run, so a person reads why it did not go on. */
  private async record(
    run: AgentPlanRun,
    state: "started" | "stopped",
    reason?: string,
  ): Promise<void> {
    // A resume settles closeouts on the stored run, so the view read at the start is out of date.
    const current = await this.dependencies.runs.find(run.id);
    if (!current?.recovery) return;
    const attempts = (run.origin?.automaticAttempt ?? 0) + 1;
    await this.dependencies.runs.update({
      ...current,
      recovery: {
        ...current.recovery,
        automaticResume: { state, ...(reason ? { reason } : {}) },
      },
      steps:
        state === "stopped"
          ? current.steps.map((step) => stoppedStep(step, attempts))
          : current.steps,
    });
    withLogContext({ runId: run.id }, () =>
      logEvent({
        level: state === "stopped" ? "warn" : "info",
        event: "agent.run.automatic_resume",
        component: "AgentPlanAutoResume",
        message:
          state === "stopped"
            ? "An interrupted run did not continue on its own"
            : "An interrupted run continues on its own",
        metadata: { state, reason: reason ?? null, attempts },
      }),
    );
  }
}

/** A failed node of a run that stopped here names the attempts of the whole chain. */
function stoppedStep(
  step: AgentPlanStepResult,
  attempts: number,
): AgentPlanStepResult {
  if (step.status !== "failed") return step;
  const stop = planFailureStop(step);
  return {
    ...step,
    failureStop:
      stop.failureClass === "infrastructure"
        ? {
            ...stop,
            attempts: Math.min(attempts, stop.maximumAttempts),
            totalAttempts: Math.max(attempts, stop.totalAttempts),
          }
        : stop,
  };
}
