import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { resolveLoopCount } from "./AgentPlanLoopCount";
import { evaluateLoopCondition } from "./AgentPlanLoopCondition";
import { AgentPlanLoopIterationRunner } from "./AgentPlanLoopIterationRunner";
import {
  beginIteration,
  initialLoopRun,
  loopSessionsOf,
  patchIteration,
  startedLoopRun,
} from "./AgentPlanLoopRecord";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type {
  AgentPlanLoopCompletion,
  AgentPlanLoopIteration,
  AgentPlanLoopRun,
} from "@/definition/AgentPlanLoopRun";
import type { AgentPlanStepRunner } from "../AgentPlanStepRunner";
import type { LoopHost } from "./AgentPlanLoopHost";
import type { LoopIterationOutcome } from "./AgentPlanLoopIterationRunner";

/** How a loop ends, before its cleanup has been checked. */
interface LoopEnd {
  readonly status: "succeeded" | "failed" | "cancelled";
  readonly completion?: AgentPlanLoopCompletion;
  readonly error?: string;
  readonly failedStepId?: string;
}

/**
 * Decides, from the recorded iterations, whether the loop is complete.
 *
 * @returns The reason it ends, or `null` when another iteration follows.
 *
 * @remarks
 * Deciding from the record makes a resume safe: it neither repeats a finished
 * iteration nor skips the decision a pause interrupted. An evaluated, met
 * condition ends a `max` loop; the count ends either mode, also after a
 * `false` condition. Nothing lets a loop run past its effective count.
 */
function completionOf(
  record: AgentPlanLoopRun,
): AgentPlanLoopCompletion | null {
  const last = record.iterations.at(-1);
  if (!record.count || last?.status !== "succeeded") return null;
  if (
    record.condition?.isActive &&
    last.condition.state === "evaluated" &&
    last.condition.isMet
  )
    return "condition_met";
  const completed = record.iterations.filter(
    (iteration) => iteration.status === "succeeded",
  ).length;
  return completed >= record.count.effective ? "count_reached" : null;
}

/** Why an iteration failed: its condition, else its first failed member. */
function iterationFailure(
  iteration: AgentPlanLoopIteration | undefined,
): LoopEnd {
  const failed = iteration?.nodes.find((node) => node.status === "failed");
  const code = iteration?.error ?? failed?.error ?? "plan_step_failed";
  return {
    status: "failed",
    error: code === "plan_group_session_lost" ? "plan_loop_session_lost" : code,
    ...(failed ? { failedStepId: failed.id } : {}),
  };
}

function resumedIteration(
  iteration: AgentPlanLoopIteration,
): Partial<AgentPlanLoopIteration> {
  return {
    status: "running",
    nodes: iteration.nodes.map((node) =>
      node.status === "paused" ? { ...node, status: "waiting" } : node,
    ),
  };
}

/**
 * Runs a loop node: the iterations of its subgraph, the counting and the cleanup.
 *
 * @remarks
 * One loop is one node of the outer graph. It resolves its count once, runs
 * iterations one after another, ends after the count or, in `max` mode, when
 * its condition is met, and ends its own sessions before it reports success,
 * so outer successors start only after a confirmed cleanup. A pause leaves
 * finished iterations and live sessions as they are; a stop or a failure
 * ends the sessions and keeps every recorded iteration.
 */
export class AgentPlanLoopRunner {
  private readonly steps: Pick<AgentPlanStepRunner, "run" | "closeGroups">;
  private readonly iterations: AgentPlanLoopIterationRunner;

  public constructor(steps: Pick<AgentPlanStepRunner, "run" | "closeGroups">) {
    this.steps = steps;
    this.iterations = new AgentPlanLoopIterationRunner(steps);
  }

  /**
   * Runs or continues the loop and returns the changes of its step result.
   *
   * @param loop - The frozen loop.
   * @param host - The engine boundary that owns the run, its signal and its writes.
   */
  public async run(
    loop: AgentPlanLoop,
    host: LoopHost,
  ): Promise<Partial<AgentPlanStepResult>> {
    try {
      return await this.drive(loop, host);
    } catch (error: unknown) {
      logCaughtError("AgentPlanLoopRunner", error);
      return this.end(loop, host, {
        status: "failed",
        error: error instanceof AgentError ? error.code : "plan_step_failed",
      });
    }
  }

  private async drive(
    loop: AgentPlanLoop,
    host: LoopHost,
  ): Promise<Partial<AgentPlanStepResult>> {
    await host.authorize();
    await this.begin(loop, host);
    for (;;) {
      const completion = completionOf(this.record(loop, host));
      if (completion)
        return this.end(loop, host, { status: "succeeded", completion });
      if (host.signal.aborted)
        return this.end(loop, host, { status: "cancelled" });
      if (!host.canDispatch())
        return host.isPausing()
          ? this.pause(loop, host)
          : this.end(loop, host, {
              status: "failed",
              error: "plan_step_failed",
            });
      const outcome = await this.iterate(loop, host);
      if (outcome === "paused") return this.pause(loop, host);
      if (outcome === "cancelled")
        return this.end(loop, host, { status: "cancelled" });
      if (outcome === "failed")
        return this.end(
          loop,
          host,
          iterationFailure(this.record(loop, host).iterations.at(-1)),
        );
    }
  }

  private record(loop: AgentPlanLoop, host: LoopHost): AgentPlanLoopRun {
    return host.current(loop.id) ?? initialLoopRun(loop);
  }

  /** Resolves the count once; a resumed loop keeps the one it resolved. */
  private async begin(loop: AgentPlanLoop, host: LoopHost): Promise<void> {
    if (this.record(loop, host).count) {
      await host.update(loop.id, (entry) => ({ ...entry, status: "running" }));
      return;
    }
    const count = resolveLoopCount(loop, host.snapshot().plan);
    await host.update(loop.id, (entry) => startedLoopRun(entry, loop, count));
  }

  /** Continues the unfinished iteration where it stopped, else starts the next. */
  private async iterate(
    loop: AgentPlanLoop,
    host: LoopHost,
  ): Promise<LoopIterationOutcome> {
    const last = this.record(loop, host).iterations.at(-1);
    let number = last?.number ?? 0;
    if (last && last.status !== "succeeded")
      await host.update(loop.id, (entry) =>
        patchIteration(entry, last.number, resumedIteration(last)),
      );
    else {
      number += 1;
      const names = new Map(
        host.snapshot().steps.map((step) => [step.step.id, step.name]),
      );
      await host.update(loop.id, (entry) => beginIteration(entry, loop, names));
    }
    const outcome = await this.iterations.run({ loop, number, host });
    if (outcome === "succeeded") return this.complete(loop, host, number);
    await this.settle(loop, host, { number, outcome });
    return outcome;
  }

  /** Marks an iteration that did not complete: failed, cancelled or paused, with the reason. */
  private async settle(
    loop: AgentPlanLoop,
    host: LoopHost,
    ended: {
      readonly number: number;
      readonly outcome: Exclude<LoopIterationOutcome, "succeeded">;
    },
  ): Promise<void> {
    await host.update(loop.id, (entry) => {
      const iteration = entry.iterations.find(
        (candidate) => candidate.number === ended.number,
      );
      if (ended.outcome === "paused")
        return patchIteration(entry, ended.number, { status: "paused" });
      return patchIteration(entry, ended.number, {
        status: ended.outcome,
        endedAt: new Date().toISOString(),
        error:
          ended.outcome === "failed" ? iterationFailure(iteration).error : null,
      });
    });
  }

  /** Writes the end of a complete iteration with the verdict of its condition. */
  private async complete(
    loop: AgentPlanLoop,
    host: LoopHost,
    number: number,
  ): Promise<LoopIterationOutcome> {
    const nodes =
      this.record(loop, host).iterations.find(
        (entry) => entry.number === number,
      )?.nodes ?? [];
    const condition = evaluateLoopCondition(
      loop,
      new Map(nodes.map((node) => [node.id, node.output])),
    );
    await host.update(loop.id, (entry) =>
      patchIteration(entry, number, {
        status: condition.state === "failed" ? "failed" : "succeeded",
        endedAt: new Date().toISOString(),
        condition,
        error: condition.state === "failed" ? condition.code : null,
      }),
    );
    return condition.state === "failed" ? "failed" : "succeeded";
  }

  private async pause(
    loop: AgentPlanLoop,
    host: LoopHost,
  ): Promise<Partial<AgentPlanStepResult>> {
    await host.update(loop.id, (entry) => ({ ...entry, status: "paused" }));
    return { status: "paused" };
  }

  /** Ends the sessions of the loop's agents, then records how the loop ended. */
  private async end(
    loop: AgentPlanLoop,
    host: LoopHost,
    ending: LoopEnd,
  ): Promise<Partial<AgentPlanStepResult>> {
    await this.closeSessions(loop, host);
    const hasUnconfirmed = this.record(loop, host).iterations.some(
      (iteration) =>
        iteration.nodes.some(
          (node) =>
            node.session?.closeout === "failed" ||
            node.session?.closeout === "pending",
        ),
    );
    const final: LoopEnd = hasUnconfirmed
      ? { ...ending, status: "failed", error: "plan_closeout_failed" }
      : ending;
    const runId = host.run().id;
    const recorded = await host
      .update(loop.id, (entry) => ({
        ...entry,
        status: final.status,
        completion: ending.completion ?? null,
        cleanup: cleanupOf(entry, hasUnconfirmed),
        endedAt: new Date().toISOString(),
        error: final.error ?? null,
        sessions: loopSessionsOf(
          { ...entry, status: final.status },
          loop,
          runId,
          false,
        ),
      }))
      .catch((error: unknown) => {
        logCaughtError("AgentPlanLoopRunner", error);
        return null;
      });
    if (recorded === null && final.status === "succeeded")
      return { status: "failed", error: "plan_step_failed" };
    return changesOf(final, host);
  }

  /** The agents' sessions of a loop that keeps them end with the loop, never earlier. */
  private async closeSessions(
    loop: AgentPlanLoop,
    host: LoopHost,
  ): Promise<void> {
    if (loop.sessionPolicy !== "reuse") return;
    const runId = host.run().id;
    for (const member of loop.steps) {
      if (member.type !== "agent") continue;
      await this.steps
        .closeGroups(runId, `${loop.id}/${member.id}`)
        .catch((error: unknown) => {
          logCaughtError("AgentPlanLoopRunner", error);
        });
    }
  }
}

function cleanupOf(
  record: AgentPlanLoopRun,
  hasUnconfirmed: boolean,
): AgentPlanLoopRun["cleanup"] {
  if (hasUnconfirmed) return "failed";
  const hasSession = record.iterations.some((iteration) =>
    iteration.nodes.some(
      (node) => node.session !== null && node.session !== undefined,
    ),
  );
  return hasSession ? "confirmed" : "not_needed";
}

function changesOf(
  ending: LoopEnd,
  host: LoopHost,
): Partial<AgentPlanStepResult> {
  if (ending.status === "succeeded")
    return { status: "succeeded", output: null, error: null };
  if (ending.status === "cancelled")
    return {
      status: "cancelled",
      cancellation: host.run().stopRequested ? "confirmed" : "not_started",
    };
  return {
    status: "failed",
    error: ending.error ?? "plan_step_failed",
    ...(ending.failedStepId ? { failedStepId: ending.failedStepId } : {}),
  };
}
