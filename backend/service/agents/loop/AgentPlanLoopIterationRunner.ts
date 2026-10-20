import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";
import { logCaughtError } from "@/backend/logging/Logger";
import { isAcpProvider } from "@/definition/AgentConfiguration";

import {
  patchIteration,
  patchIterationNode,
  withLoopSessions,
} from "./AgentPlanLoopRecord";
import { loopRunView, loopStepInput } from "./AgentPlanLoopStep";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentPlanLoop,
  AgentPlanLoopMember,
} from "@/definition/AgentPlanLoop";
import type { AgentPlanLoopIteration } from "@/definition/AgentPlanLoopRun";
import type { AgentPlanStepRunner } from "../AgentPlanStepRunner";
import type { LoopHost } from "./AgentPlanLoopHost";

/** How one iteration of a loop ended. */
export type LoopIterationOutcome =
  "succeeded" | "failed" | "cancelled" | "paused";

/** The iteration a member runs in. */
interface IterationTarget {
  readonly loop: AgentPlanLoop;
  readonly number: number;
  readonly host: LoopHost;
}

function nodeOf(
  iteration: AgentPlanLoopIteration | undefined,
  nodeId: string,
): AgentPlanStepResult | undefined {
  return iteration?.nodes.find((node) => node.id === nodeId);
}

/**
 * Runs the subgraph of a loop once: members as their dependencies allow.
 *
 * @remarks
 * This is the loop's inner schedule, not a second engine. Members without an
 * unfinished predecessor start together; agents of ACP runners run side by
 * side, other runners one at a time like the engine limits them. The state of
 * every member is written through the host, so a pause can end the iteration
 * between members and a resume continues it where it stopped.
 */
export class AgentPlanLoopIterationRunner {
  private readonly steps: Pick<AgentPlanStepRunner, "run">;

  public constructor(steps: Pick<AgentPlanStepRunner, "run">) {
    this.steps = steps;
  }

  /**
   * Runs the members of one iteration until it ends, pauses or is stopped.
   *
   * @param target - The loop, the iteration number and the engine boundary.
   * @returns How the iteration ended; `paused` leaves finished members as
   * they are and the others waiting.
   */
  public async run(target: IterationTarget): Promise<LoopIterationOutcome> {
    const running = new Map<string, Promise<void>>();
    try {
      for (;;) {
        if (target.host.canDispatch() && !this.hasEnded(target))
          await this.dispatch(target, running);
        if (running.size === 0) break;
        await Promise.race(running.values());
      }
    } finally {
      await Promise.allSettled(running.values());
    }
    return this.settle(target);
  }

  private iteration(
    target: IterationTarget,
  ): AgentPlanLoopIteration | undefined {
    return target.host
      .current(target.loop.id)
      ?.iterations.find((entry) => entry.number === target.number);
  }

  private hasEnded(target: IterationTarget): boolean {
    return (
      this.iteration(target)?.nodes.some(
        (node) => node.status === "failed" || node.status === "cancelled",
      ) ?? true
    );
  }

  private async dispatch(
    target: IterationTarget,
    running: Map<string, Promise<void>>,
  ): Promise<void> {
    for (const member of this.ready(target, running)) {
      if (!target.host.canDispatch()) return;
      if (!this.mayStart(target, member, running)) continue;
      await target.host.update(target.loop.id, (record) =>
        patchIterationNode(
          record,
          { number: target.number, nodeId: member.id },
          { status: "running", error: null },
        ),
      );
      const pending = this.execute(target, member).finally(() => {
        running.delete(member.id);
      });
      running.set(member.id, pending);
    }
  }

  private ready(
    target: IterationTarget,
    running: ReadonlyMap<string, unknown>,
  ): readonly AgentPlanLoopMember[] {
    const iteration = this.iteration(target);
    return target.loop.steps.filter(
      (member) =>
        nodeOf(iteration, member.id)?.status === "waiting" &&
        !running.has(member.id) &&
        target.loop.edges
          .filter((edge) => edge.to === member.id)
          .every(
            (edge) => nodeOf(iteration, edge.from)?.status === "succeeded",
          ),
    );
  }

  /** ACP agents and scripts run side by side; any other runner takes a turn alone. */
  private mayStart(
    target: IterationTarget,
    member: AgentPlanLoopMember,
    running: ReadonlyMap<string, unknown>,
  ): boolean {
    const providers = target.host.snapshot().steps;
    const isRequest = (id: string): boolean => {
      const step = providers.find((entry) => entry.step.id === id);
      return step !== undefined && !isAcpProvider(step.provider);
    };
    return !isRequest(member.id) || ![...running.keys()].some(isRequest);
  }

  private async execute(
    target: IterationTarget,
    member: AgentPlanLoopMember,
  ): Promise<void> {
    const changes = this.afterStop(
      target,
      await this.runMember(target, member),
    );
    try {
      await target.host.update(target.loop.id, (record) =>
        withLoopSessions(
          patchIterationNode(
            record,
            { number: target.number, nodeId: member.id },
            changes,
          ),
          target.loop,
          target.host.run().id,
        ),
      );
    } catch (error: unknown) {
      // The engine has stopped the run; the member stays unfinished and the iteration fails.
      logCaughtError("AgentPlanLoopIterationRunner", error);
    }
  }

  /** A member that failed while the run was being stopped was cancelled by the stop, not by a fault of its own. */
  private afterStop(
    target: IterationTarget,
    changes: Partial<AgentPlanStepResult>,
  ): Partial<AgentPlanStepResult> {
    if (changes.status !== "failed" || !target.host.run().stopRequested)
      return changes;
    return {
      ...changes,
      status: "cancelled",
      cancellation: "confirmed",
      error: null,
    };
  }

  private async runMember(
    target: IterationTarget,
    member: AgentPlanLoopMember,
  ): Promise<Partial<AgentPlanStepResult>> {
    // Pages runs no scripts yet; a script member fails in the open rather than being skipped.
    if (member.type === "script")
      return { status: "failed", error: "plan_script_unavailable" };
    const { host, loop, number } = target;
    const base = host
      .snapshot()
      .steps.find((entry) => entry.step.id === member.id);
    const iteration = this.iteration(target);
    if (!base || !iteration)
      return { status: "failed", error: "plan_binding_invalid" };
    const previous = host
      .current(loop.id)
      ?.iterations.find((entry) => entry.number === number - 1);
    const input = loopStepInput(base, iteration.nodes, previous);
    let isClaimed = false;
    try {
      return await this.steps.run(
        loopRunView(host.run(), input.results),
        host.snapshot(),
        input.step,
        {
          signal: host.signal,
          iteration: number,
          claimStart: () => {
            if (isClaimed) return;
            if (!host.canDispatch()) throw new AgentPlanPausedError();
            isClaimed = true;
          },
          save: async (session) => {
            await host
              .update(loop.id, (record) =>
                patchIterationNode(
                  record,
                  { number, nodeId: member.id },
                  { session },
                ),
              )
              .catch((error: unknown) => {
                logCaughtError("AgentPlanLoopIterationRunner", error);
              });
          },
        },
      );
    } catch (error: unknown) {
      logCaughtError("AgentPlanLoopIterationRunner", error);
      return { status: "failed", error: "plan_step_failed" };
    }
  }

  /** Decides how the iteration ended and marks the members that never started. */
  private async settle(target: IterationTarget): Promise<LoopIterationOutcome> {
    const nodes = this.iteration(target)?.nodes ?? [];
    // A member still marked running lost its result with a failed write.
    const hasFailed = nodes.some(
      (node) => node.status === "failed" || node.status === "running",
    );
    const outcome = this.outcomeOf(target, nodes, hasFailed);
    if (outcome === "failed" || outcome === "cancelled")
      await target.host.update(target.loop.id, (record) =>
        patchIteration(record, target.number, {
          nodes: nodes.map((node) => unstarted(node, outcome)),
        }),
      );
    return outcome;
  }

  private outcomeOf(
    target: IterationTarget,
    nodes: readonly AgentPlanStepResult[],
    hasFailed: boolean,
  ): LoopIterationOutcome {
    if (hasFailed) return "failed";
    if (
      target.host.signal.aborted ||
      nodes.some((n) => n.status === "cancelled")
    )
      return "cancelled";
    if (nodes.every((node) => node.status === "succeeded")) return "succeeded";
    return target.host.isPausing() ? "paused" : "failed";
  }
}

/** A member that never started is blocked by a failure and cancelled by a stop. */
function unstarted(
  node: AgentPlanStepResult,
  outcome: "failed" | "cancelled",
): AgentPlanStepResult {
  if (node.status === "running")
    return { ...node, status: "failed", error: "plan_step_failed" };
  if (node.status !== "waiting" && node.status !== "paused") return node;
  return outcome === "failed"
    ? {
        ...node,
        status: "waiting",
        isBlocked: true,
        error: "plan_dependency_failed",
      }
    : {
        ...node,
        status: "cancelled",
        cancellation: "not_started",
        isBlocked: false,
      };
}
