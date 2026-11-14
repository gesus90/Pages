import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";
import { logCaughtError } from "@/backend/logging/Logger";
import { isAcpProvider } from "@/definition/AgentConfiguration";
import { hasPlanPath } from "@/definition/AgentPlanGraph";
import {
  planLoopDecisions,
  planLoopMembers,
  planLoopScopeEdges,
} from "@/definition/AgentPlanLoop";
import { planDecisionMode } from "@/definition/AgentPlanDecision";

import { planEdgeState } from "../branching/AgentPlanBranchEdges";
import {
  decidePlanBoolean,
  invalidDecisionInput,
} from "../branching/AgentPlanDecisionValue";
import {
  patchIteration,
  patchIterationNode,
  withLoopSessions,
} from "./AgentPlanLoopRecord";
import {
  loopRunView,
  loopScriptInput,
  loopStepInput,
} from "./AgentPlanLoopStep";

import type {
  AgentPlanDecision,
  AgentPlanEdge,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type {
  AgentPlanLoop,
  AgentPlanLoopMember,
} from "@/definition/AgentPlanLoop";
import type { AgentPlanLoopIteration } from "@/definition/AgentPlanLoopRun";
import type { AgentPlanScriptRunner } from "../AgentPlanScriptRunner";
import type { AgentPlanStepRunner } from "../AgentPlanStepRunner";
import type { AgentPlanDecisionModel } from "../branching/AgentPlanDecisionModel";
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

/** Whether a node of an iteration may start, can no longer start in it, or has to wait. */
type IterationReadiness = "ready" | "skip" | "wait";

/** What an iteration starts as work: its agents and scripts, and its model decisions. */
type IterationWork = AgentPlanLoopMember | AgentPlanDecision;

function iterationResults(
  iteration: AgentPlanLoopIteration | undefined,
): ReadonlyMap<string, AgentPlanStepResult> {
  return new Map((iteration?.nodes ?? []).map((node) => [node.id, node]));
}

function nodeOf(
  iteration: AgentPlanLoopIteration | undefined,
  nodeId: string,
): AgentPlanStepResult | undefined {
  return iteration?.nodes.find((node) => node.id === nodeId);
}

/** A node of an iteration that never ran because the edges into it are dead is done, like a succeeded one. */
function isSettled(node: AgentPlanStepResult): boolean {
  return node.status === "succeeded" || node.status === "skipped";
}

/**
 * Runs the subgraph of a loop once: members as their dependencies allow.
 *
 * @remarks
 * This is the loop's inner schedule, not a second engine. Members without an
 * unfinished predecessor start together; agents of ACP runners and scripts run
 * side by side, other runners one at a time like the engine limits them. The
 * agents of a group take turns in their shared session. A decision decides
 * anew in every iteration: a boolean one at once, a model one as work of its
 * own; what it skips is skipped in this iteration only. A stack the loop
 * triggers is a node of the iteration as well: when it is ready the host hands
 * over its next entry, and a used-up stack kills the edges out of it, so what
 * lies behind it is skipped in this iteration. The state of every node is
 * written through the host, so a pause can end the iteration between members
 * and a resume continues it where it stopped.
 */
export class AgentPlanLoopIterationRunner {
  private readonly steps: Pick<AgentPlanStepRunner, "run">;
  private readonly scripts: Pick<AgentPlanScriptRunner, "run"> | undefined;
  private readonly decisions: Pick<AgentPlanDecisionModel, "run"> | undefined;

  public constructor(
    steps: Pick<AgentPlanStepRunner, "run">,
    scripts?: Pick<AgentPlanScriptRunner, "run">,
    decisions?: Pick<AgentPlanDecisionModel, "run">,
  ) {
    this.steps = steps;
    this.scripts = scripts;
    this.decisions = decisions;
  }

  /**
   * Runs the nodes of one iteration until it ends, pauses or is stopped.
   *
   * @param target - The loop, the iteration number and the engine boundary.
   * @returns How the iteration ended; `paused` leaves finished nodes as
   * they are and the others waiting.
   */
  public async run(target: IterationTarget): Promise<LoopIterationOutcome> {
    const running = new Map<string, Promise<void>>();
    try {
      for (;;) {
        if (!target.host.signal.aborted) await target.host.waitUntilRunning?.();
        if (await this.schedule(target, running)) continue;
        if (running.size === 0) break;
        await Promise.race(running.values());
      }
    } finally {
      await Promise.allSettled(running.values());
    }
    return this.settle(target);
  }

  /**
   * Skips, triggers and starts what the iteration allows now.
   *
   * @returns Whether a skip or a trigger changed the iteration, so it is decided again at once.
   */
  private async schedule(
    target: IterationTarget,
    running: Map<string, Promise<void>>,
  ): Promise<boolean> {
    this.reattachRunning(target, running);
    if (!target.host.canDispatch() || this.hasEnded(target)) return false;
    if (await this.advance(target, running)) return true;
    await this.dispatch(target, running);
    return false;
  }

  private reattachRunning(
    target: IterationTarget,
    running: Map<string, Promise<void>>,
  ): void {
    for (const member of this.work(target)) {
      if (
        nodeOf(this.iteration(target), member.id)?.status !== "running" ||
        running.has(member.id)
      )
        continue;
      const pending = this.execute(target, member).finally(() => {
        running.delete(member.id);
      });
      running.set(member.id, pending);
    }
  }

  /** The members and model decisions of the loop, which run as work of the iteration. */
  private work(target: IterationTarget): readonly IterationWork[] {
    return [
      ...planLoopMembers(target.loop),
      ...planLoopDecisions(target.loop).filter(
        (decision) => planDecisionMode(decision) === "model",
      ),
    ];
  }

  private iteration(
    target: IterationTarget,
  ): AgentPlanLoopIteration | undefined {
    return target.host
      .current(target.loop.id)
      ?.iterations.find((entry) => entry.number === target.number);
  }

  private edges(target: IterationTarget): readonly AgentPlanEdge[] {
    return planLoopScopeEdges(target.host.snapshot().plan, target.loop);
  }

  private hasEnded(target: IterationTarget): boolean {
    return (
      this.iteration(target)?.nodes.some(
        (node) => node.status === "failed" || node.status === "cancelled",
      ) ?? true
    );
  }

  /**
   * Whether a waiting node of the iteration may start.
   *
   * @remarks
   * Every edge into it must have an answer; one satisfied edge is enough, and
   * a node whose every edge is dead is skipped, which spreads along its edges.
   */
  private readiness(
    target: IterationTarget,
    nodeId: string,
  ): IterationReadiness {
    const iteration = this.iteration(target);
    const states = this.edges(target)
      .filter((edge) => edge.to === nodeId)
      .map((edge) => planEdgeState(edge, nodeOf(iteration, edge.from)));
    if (states.length === 0) return "ready";
    if (states.includes("pending")) return "wait";
    return states.includes("satisfied") ? "ready" : "skip";
  }

  /** The waiting nodes of the iteration that nothing runs for yet. */
  private waiting(
    target: IterationTarget,
    running: ReadonlyMap<string, unknown>,
  ): readonly AgentPlanStepResult[] {
    return (this.iteration(target)?.nodes ?? []).filter(
      (node) =>
        (node.status === "waiting" || node.status === "running") &&
        !running.has(node.id),
    );
  }

  /**
   * Skips the nodes behind dead edges and triggers the stacks that are ready.
   *
   * @returns Whether anything changed, so readiness has to be decided again.
   */
  private async advance(
    target: IterationTarget,
    running: ReadonlyMap<string, unknown>,
  ): Promise<boolean> {
    const { plan } = target.host.snapshot();
    for (const node of this.waiting(target, running)) {
      const readiness = this.readiness(target, node.id);
      if (readiness === "skip") {
        await target.host.update(target.loop.id, (record) =>
          patchIterationNode(
            record,
            { number: target.number, nodeId: node.id },
            { status: "skipped", output: null, error: null },
          ),
        );
        return true;
      }
      if (readiness === "ready" && (await this.decide(target, node.id)))
        return true;
      const isStack = plan.nodes.some(
        (entry) => entry.id === node.id && entry.type === "stack",
      );
      if (readiness === "ready" && isStack) {
        await target.host.triggerStack(target.loop.id, {
          number: target.number,
          stackId: node.id,
        });
        return true;
      }
    }
    return false;
  }

  /**
   * Decides a boolean decision of the iteration that the flow has reached.
   *
   * @returns Whether it was one; a model decision is dispatched as work instead.
   */
  private async decide(
    target: IterationTarget,
    nodeId: string,
  ): Promise<boolean> {
    const decision = planLoopDecisions(target.loop).find(
      (entry) => entry.id === nodeId,
    );
    if (!decision || planDecisionMode(decision) !== "boolean") return false;
    const changes = decidePlanBoolean(decision, {
      plan: target.host.snapshot().plan,
      edges: this.edges(target),
      results: iterationResults(this.iteration(target)),
    });
    await target.host.update(target.loop.id, (record) =>
      patchIterationNode(record, { number: target.number, nodeId }, changes),
    );
    return true;
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
  ): readonly IterationWork[] {
    const members = this.work(target);
    return this.waiting(target, running).flatMap((node) => {
      const member = members.find((entry) => entry.id === node.id);
      return member && this.readiness(target, node.id) === "ready"
        ? [member]
        : [];
    });
  }

  /** ACP agents and scripts run side by side; any other runner takes a turn alone. */
  private mayStart(
    target: IterationTarget,
    member: IterationWork,
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
    member: IterationWork,
  ): Promise<void> {
    const changes = this.afterStop(target, await this.runWork(target, member));
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

  private runWork(
    target: IterationTarget,
    member: IterationWork,
  ): Promise<Partial<AgentPlanStepResult>> {
    if (member.type === "decision") return this.runDecision(target, member);
    return member.type === "script"
      ? this.runScript(target, member.id)
      : this.runMember(target, member);
  }

  /** Asks the model of a decision about this iteration's result or a ticket, in a session of its own. */
  private runDecision(
    target: IterationTarget,
    decision: AgentPlanDecision,
  ): Promise<Partial<AgentPlanStepResult>> {
    const { host } = target;
    if (!this.decisions) return Promise.resolve(invalidDecisionInput());
    return this.decisions.run({
      run: host.run(),
      snapshot: host.snapshot(),
      decision,
      results: iterationResults(this.iteration(target)),
      signal: host.signal,
      authorize: host.authorize,
    });
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

  /** The iteration before this one, whose results `previous` bindings read. */
  private previous(
    target: IterationTarget,
  ): AgentPlanLoopIteration | undefined {
    return target.host
      .current(target.loop.id)
      ?.iterations.find((entry) => entry.number === target.number - 1);
  }

  /**
   * Runs a script member as a process, with this iteration's results as its inputs.
   *
   * @remarks
   * The script runs like a script of the outer graph, through the same runner
   * and rights; only its record is written into this iteration.
   */
  private async runScript(
    target: IterationTarget,
    memberId: string,
  ): Promise<Partial<AgentPlanStepResult>> {
    const { host, loop, number } = target;
    const base = host
      .snapshot()
      .scripts?.find((entry) => entry.step.id === memberId);
    const iteration = this.iteration(target);
    if (!base || !this.scripts)
      return { status: "failed", error: "plan_script_interpreter_unavailable" };
    if (!iteration) return { status: "failed", error: "plan_binding_invalid" };
    const input = loopScriptInput(base, iteration.nodes, this.previous(target));
    try {
      return await this.scripts.run(
        loopRunView(host.run(), input.results),
        host.snapshot(),
        input.script,
        {
          signal: host.signal,
          claimStart: () => {
            host.signal.throwIfAborted();
            if (!host.canDispatch()) throw new AgentPlanPausedError();
          },
          save: async (record) => {
            await host.update(loop.id, (entry) =>
              patchIterationNode(
                entry,
                { number, nodeId: memberId },
                { script: record },
              ),
            );
          },
        },
      );
    } catch (error: unknown) {
      logCaughtError("AgentPlanLoopIterationRunner", error);
      return { status: "failed", error: "plan_step_failed" };
    }
  }

  private async runMember(
    target: IterationTarget,
    member: AgentPlanLoopMember,
  ): Promise<Partial<AgentPlanStepResult>> {
    const { host, loop, number } = target;
    const base = host
      .snapshot()
      .steps.find((entry) => entry.step.id === member.id);
    const iteration = this.iteration(target);
    if (!base || !iteration)
      return { status: "failed", error: "plan_binding_invalid" };
    const input = loopStepInput(base, iteration.nodes, this.previous(target));
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
    if (outcome === "failed" || outcome === "cancelled") {
      const edges = this.edges(target);
      await target.host.update(target.loop.id, (record) =>
        patchIteration(record, target.number, {
          nodes: nodes.map((node) =>
            unstarted(node, outcome, failedPredecessor(node, nodes, edges)),
          ),
        }),
      );
    }
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
    if (nodes.every(isSettled)) return "succeeded";
    return target.host.isPausing() ? "paused" : "failed";
  }
}

/** Finds an actual failed predecessor, including one whose result was lost. */
function failedPredecessor(
  node: AgentPlanStepResult,
  nodes: readonly AgentPlanStepResult[],
  edges: readonly AgentPlanEdge[],
): string | undefined {
  const source = nodes.find(
    (candidate) =>
      (candidate.status === "failed" ||
        candidate.status === "running" ||
        candidate.status === "cancelled") &&
      hasPlanPath(edges, candidate.id, node.id),
  );
  return source?.failedStepId ?? source?.id;
}

/** A member that never started is blocked by a failure and cancelled by a stop. */
function unstarted(
  node: AgentPlanStepResult,
  outcome: "failed" | "cancelled",
  blockedByStepId: string | undefined,
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
        blockedByStepId,
      }
    : {
        ...node,
        status: "cancelled",
        cancellation: "not_started",
        isBlocked: false,
        blockedByStepId: undefined,
      };
}
