import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { logCaughtError } from "@/backend/logging/Logger";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { PLAN_SIGNAL_PAYLOAD_BINDING } from "@/definition/AgentPlanJump";

import { planPauseGate } from "../AgentPlanPauseGate";
import { hasUnconfirmedRunCloseout, patchStep } from "../AgentPlanRunState";
import { sharedAgentPlanRunObservers } from "../AgentPlanRunObservers";
import {
  presentValues,
  resolveNodeValues,
} from "./AgentPlanInvocationBindings";
import { callIdentity, findOrCreateCall } from "./AgentPlanInvocationCall";
import {
  jumpFailure,
  jumpOutcome,
  jumpRunView,
} from "./AgentPlanInvocationOutcome";
import { AgentPlanInvocationStarter } from "./AgentPlanInvocationStarter";
import { AgentPlanInvocationWait } from "./AgentPlanInvocationWait";
import { AgentPlanInvocationWakeups } from "./AgentPlanInvocationWakeups";

import type {
  AgentPlanInvocationRecord,
  AgentPlanInvocationRepository,
} from "@/backend/database/repositories/agent/AgentPlanInvocationRepository";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanEnd, AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentPlanJumpOut,
  AgentPlanSignal,
  AgentPlanSignalRun,
} from "@/definition/AgentPlanJump";
import type { AgentPlanAccess } from "../AgentPlanAccess";
import type { AgentPlanPreparation } from "../AgentPlanPreparation";
import type { ActivePlanRun } from "../AgentPlanRunState";
import type { EngineDependencies } from "../AgentPlanEngineDependencies";
import type { PlanRunEnginePort } from "../runs/PlanRunEnginePort";

/** How soon a call that had to wait for its turn is tried again. */
const RETRY_MS = 5_000;

/** What the engine lends the dispatch of a call node. */
export interface InvocationNodeContext {
  readonly writes: SerialQueue;
  readonly runs: Pick<EngineDependencies["runs"], "update">;
  /** Authorizes the executor for this node again. */
  readonly authorize: () => Promise<void>;
}

/** What the call service is built from. */
export interface AgentPlanInvocationDependencies {
  readonly invocations: AgentPlanInvocationRepository;
  readonly access: Pick<AgentPlanAccess, "require">;
  readonly runs: Pick<AgentPlanRunRepository, "find">;
  readonly preparation: Pick<AgentPlanPreparation, "prepare">;
}

/** The engine this service starts and stops runs through. */
export type InvocationEngine = Pick<
  PlanRunEnginePort,
  "start" | "stop" | "isShuttingDown"
>;

/**
 * Makes plans call each other: dispatches outgoing Jumps, signals and ends, and starts the queued calls.
 * @remarks
 * It lives in the process that owns the runs. The call register is the single
 * truth; this class only reads it, decides through it and wakes the waiters.
 * No second engine is involved: called runs are started through the engine
 * of this process with a start that never displaces another run.
 */
export class AgentPlanInvocations {
  private readonly dependencies: AgentPlanInvocationDependencies;
  private readonly wakeups = new AgentPlanInvocationWakeups();
  private readonly startQueue = new SerialQueue();
  private readonly drainQueue = new SerialQueue();
  /** Calls whose calling run was brought to rest, so their workspace may be handed over. */
  private readonly quiesced = new Set<string>();
  private readonly starter: AgentPlanInvocationStarter;
  private readonly waiter: AgentPlanInvocationWait;
  private engine: InvocationEngine | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private removeObserver: (() => void) | null = null;

  public constructor(dependencies: AgentPlanInvocationDependencies) {
    this.dependencies = dependencies;
    this.starter = new AgentPlanInvocationStarter({
      invocations: dependencies.invocations,
      access: dependencies.access,
      runs: dependencies.runs,
      preparation: dependencies.preparation,
      engine: () => this.engine,
    });
    this.waiter = new AgentPlanInvocationWait({
      invocations: dependencies.invocations,
      runs: dependencies.runs,
      wakeups: this.wakeups,
      stop: async (runId) => {
        await this.engine?.stop(runId);
      },
    });
  }

  /** Hands over the engine of this process once it exists. */
  public attach(engine: InvocationEngine): void {
    this.engine = engine;
  }

  /**
   * Starts listening for the end of called runs and takes up calls a restart left open.
   * @remarks
   * Calls whose calling run is no longer active are cancelled, which stops
   * their bound target; every other open call is picked up again by its
   * waiting Jump, which the engine restores, or by the queue.
   */
  public async start(): Promise<void> {
    this.removeObserver ??= sharedAgentPlanRunObservers().add({
      runChanged: (previous, next) => {
        if (isActivePlanRun(previous.status) && !isActivePlanRun(next.status))
          void this.runEnded(next.id, next.status);
      },
    });
    await this.reconcile();
  }

  /** Stops listening and cancels the retry timer. */
  public stop(): void {
    this.removeObserver?.();
    this.removeObserver = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /**
   * Runs one outgoing Jump: stores its call, starts the target and waits as configured.
   * @param active - The calling run.
   * @param node - The Jump node.
   * @param controller - Aborted when the calling run stops.
   * @param context - The engine's write queue, run store and authorization.
   * @returns The result of the node.
   */
  public async call(
    active: ActivePlanRun,
    node: AgentPlanJumpOut,
    controller: AbortController,
    context: InvocationNodeContext,
  ): Promise<Partial<AgentPlanStepResult>> {
    try {
      await context.authorize();
      const record = await findOrCreateCall(active, node, this.dependencies);
      await this.saveJump(active, node, record, context);
      return await this.follow(active, node, record, controller.signal);
    } catch (error: unknown) {
      return this.callFailure(active, node, error);
    } finally {
      if (node.workspace === "shared") active.isHandingOver = false;
    }
  }

  /**
   * Runs a signal node: hands its message to the caller of this run.
   * @param active - The run that sends the signal.
   * @param node - The signal node.
   * @param context - The engine's authorization.
   * @returns The result of the node; `signal.delivered` says whether the message was accepted.
   */
  public async signal(
    active: ActivePlanRun,
    node: AgentPlanSignal,
    context: Pick<InvocationNodeContext, "authorize">,
  ): Promise<Partial<AgentPlanStepResult>> {
    try {
      await context.authorize();
      const call = await this.dependencies.invocations.findByTargetRun(
        active.view.id,
      );
      if (!call) return this.signalResult(node, "no_caller");
      const declared = node.payloadType
        ? [{ name: PLAN_SIGNAL_PAYLOAD_BINDING, type: node.payloadType }]
        : [];
      const payload =
        presentValues(resolveNodeValues(active, declared, node.bindings))[
          PLAN_SIGNAL_PAYLOAD_BINDING
        ] ?? null;
      const accepted = await this.dependencies.invocations.acceptSignal(
        call.id,
        active.view.id,
        { name: node.signalName, payload },
        new Date().toISOString(),
      );
      if (accepted) {
        this.wakeups.notify(call.id);
        return this.signalResult(node, "delivered");
      }
      const isRepeat =
        (await this.dependencies.invocations.signal(
          call.id,
          node.signalName,
        )) !== null;
      return this.signalResult(node, isRepeat ? "duplicate" : "closed");
    } catch (error: unknown) {
      return this.nodeFailure(error);
    }
  }

  /**
   * Runs an end: a run that was called hands the values its end declares back to the caller.
   * @param active - The run.
   * @param node - The end node.
   * @param context - The engine's authorization.
   */
  public async end(
    active: ActivePlanRun,
    node: AgentPlanEnd,
    context: Pick<InvocationNodeContext, "authorize">,
  ): Promise<Partial<AgentPlanStepResult>> {
    try {
      await context.authorize();
      const declared = node.returns ?? [];
      if (!active.snapshot.invocation || declared.length === 0)
        return { status: "succeeded", output: null, error: null };
      const values = presentValues(
        resolveNodeValues(active, declared, node.bindings ?? {}),
      );
      // An end that cannot deliver every declared value fails the run instead of returning less.
      if (declared.some((entry) => values[entry.name] === undefined))
        throw new AgentError("plan_jump_input_invalid");
      return {
        status: "succeeded",
        output: null,
        error: null,
        returned: values,
      };
    } catch (error: unknown) {
      return this.nodeFailure(error);
    }
  }

  /**
   * Starts the calls that are due, one run per target plan at a time, oldest first.
   * @remarks
   * A call whose target plan or workspace is in use stays queued and is tried
   * again when a run ends or after a short pause; nothing is displaced.
   */
  public drain(): Promise<void> {
    return this.drainQueue.run(async () => {
      const seen = new Set<string>();
      let isOpen = false;
      for (const record of await this.dependencies.invocations.pendingStarts()) {
        if (seen.has(record.targetPlanId)) {
          isOpen = true;
          continue;
        }
        seen.add(record.targetPlanId);
        // The calling run hands its workspace over itself once it is at rest.
        if (record.workspace === "shared" && !this.quiesced.has(record.id)) {
          isOpen = true;
          continue;
        }
        if ((await this.attempt(record)) === "blocked") isOpen = true;
      }
      if (isOpen) this.scheduleRetry();
    });
  }

  private async follow(
    active: ActivePlanRun,
    node: AgentPlanJumpOut,
    record: AgentPlanInvocationRecord,
    signal: AbortSignal,
  ): Promise<Partial<AgentPlanStepResult>> {
    let current = record;
    if (
      record.decidedAt === null &&
      record.workspace === "shared" &&
      record.handover === "none"
    )
      await this.prepareHandover(active, node, record, signal);
    if (record.start === "pending") {
      await this.attempt(record);
      current = (await this.dependencies.invocations.find(record.id)) ?? record;
    }
    if (current.wait !== "continue")
      current = await this.waiter.wait(current, signal);
    if (current.decidedAt === null) return this.cancelled(current);
    await this.waiter.release(current);
    try {
      // The deadline ran on while the run was paused; the exit is taken after it goes on.
      await planPauseGate(active.view.id).wait(signal);
    } catch (error: unknown) {
      if (error instanceof AgentPlanCancelledError)
        return this.cancelled(current);
      throw error;
    }
    const decided =
      (await this.dependencies.invocations.find(current.id)) ?? current;
    return jumpOutcome(decided, node, active.snapshot.plan);
  }

  private async prepareHandover(
    active: ActivePlanRun,
    node: AgentPlanJumpOut,
    record: AgentPlanInvocationRecord,
    signal: AbortSignal,
  ): Promise<void> {
    await quiesceForHandover(active, node.id, {
      signal,
      deadline:
        record.deadlineAt === null ? null : Date.parse(record.deadlineAt),
    });
    this.quiesced.add(record.id);
  }

  private async cancelled(
    record: AgentPlanInvocationRecord,
  ): Promise<Partial<AgentPlanStepResult>> {
    await this.waiter.cancel(record, "plan_jump_cancelled");
    this.quiesced.delete(record.id);
    return { status: "cancelled", cancellation: "requested" };
  }

  private async callFailure(
    active: ActivePlanRun,
    node: AgentPlanJumpOut,
    error: unknown,
  ): Promise<Partial<AgentPlanStepResult>> {
    if (error instanceof AgentPlanCancelledError) {
      await this.cancelCall(active, node, "plan_jump_cancelled");
      return { status: "cancelled", cancellation: "requested" };
    }
    if (!(error instanceof AgentError)) throw error;
    await this.cancelCall(active, node, error.code);
    return jumpFailure(active.snapshot.plan, node, error.code);
  }

  /** A call that failed or was cancelled before its decision no longer waits for anything. */
  private async cancelCall(
    active: ActivePlanRun,
    node: AgentPlanJumpOut,
    reason: string,
  ): Promise<void> {
    const record = await this.dependencies.invocations.findBySource(
      active.view.id,
      node.id,
      callIdentity(active, node).key,
    );
    if (record) await this.waiter.cancel(record, reason);
  }

  private nodeFailure(error: unknown): Partial<AgentPlanStepResult> {
    if (error instanceof AgentPlanCancelledError)
      return { status: "cancelled", cancellation: "requested" };
    if (!(error instanceof AgentError)) throw error;
    return { status: "failed", error: error.code };
  }

  private signalResult(
    node: AgentPlanSignal,
    reason: AgentPlanSignalRun["reason"],
  ): Partial<AgentPlanStepResult> {
    return {
      status: "succeeded",
      output: null,
      error: null,
      signal: {
        delivered: reason === "delivered",
        reason,
        name: node.signalName,
      },
    };
  }

  /** Writes where the call stands into the run, so a restart finds the waiting Jump again. */
  private async saveJump(
    active: ActivePlanRun,
    node: AgentPlanJumpOut,
    record: AgentPlanInvocationRecord,
    context: InvocationNodeContext,
  ): Promise<void> {
    await context.writes.run(async () => {
      if (
        active.view.steps.find((step) => step.id === node.id)?.status !==
        "running"
      )
        return;
      patchStep(active, node.id, { jump: jumpRunView(record, node) });
      await context.runs.update(active.view);
    });
  }

  /** Tries to create the run of one call; a failure that no wait can lift ends the call. */
  private attempt(
    record: AgentPlanInvocationRecord,
  ): Promise<"started" | "blocked" | "decided"> {
    return this.startQueue.run(async () => {
      const invocations = this.dependencies.invocations;
      const fresh = await invocations.find(record.id);
      if (!fresh || fresh.start !== "pending") return "decided";
      // A call that timed out or was cancelled never starts; one that went on at once still does.
      if (fresh.decidedAt !== null && fresh.state !== "accepted") {
        await invocations.cancelStart(fresh.id, new Date().toISOString());
        return "decided";
      }
      const result = await this.starter.start(fresh);
      if (result.kind === "blocked") {
        // A call that waits for a run that waits for it would wait for ever; it fails with a concrete reason.
        if (await this.isDeadlocked(fresh, result.owners)) {
          await this.endUnstartable(fresh, "plan_jump_resource_cycle");
          return "decided";
        }
        return "blocked";
      }
      if (result.kind === "started") {
        this.wakeups.notify(fresh.id);
        return "started";
      }
      await this.endUnstartable(fresh, result.code);
      return "decided";
    });
  }

  private async isDeadlocked(
    record: AgentPlanInvocationRecord,
    owners: readonly string[],
  ): Promise<boolean> {
    return (
      record.decidedAt === null &&
      record.wait !== "continue" &&
      (await isWaitCycle(
        this.dependencies.invocations,
        record.sourceRunId,
        owners,
      ))
    );
  }

  private async endUnstartable(
    record: AgentPlanInvocationRecord,
    code: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const invocations = this.dependencies.invocations;
    if (record.decidedAt === null)
      await invocations.decide(
        record.id,
        { state: "failed", reason: code, outcome: null },
        now,
      );
    await invocations.failStart(record.id, code, now);
    this.quiesced.delete(record.id);
    this.wakeups.notify(record.id);
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.drain().catch((error: unknown) => {
        logCaughtError("AgentPlanInvocations", error);
      });
    }, RETRY_MS);
    this.retryTimer.unref();
  }

  private async runEnded(runId: string, status: string): Promise<void> {
    try {
      await this.dependencies.invocations.recordTargetStatus(
        runId,
        status,
        new Date().toISOString(),
      );
      const call = await this.dependencies.invocations.findByTargetRun(runId);
      if (call) this.wakeups.notify(call.id);
      await this.drain();
    } catch (error: unknown) {
      logCaughtError("AgentPlanInvocations", error);
    }
  }

  /** Cancels what a restart left behind and starts what is due. */
  private async reconcile(): Promise<void> {
    for (const call of await this.dependencies.invocations.undecided()) {
      const source = await this.dependencies.runs.find(call.sourceRunId);
      if (source && isActivePlanRun(source.status)) continue;
      await this.waiter.cancel(call, "plan_jump_cancelled");
    }
    // A call that was decided while its target still ran, such as one that timed out, still owes its stop.
    for (const call of await this.dependencies.invocations.openTargets())
      await this.waiter.release(call);
    await this.drain();
  }
}

async function isWaitCycle(
  invocations: Pick<AgentPlanInvocationRepository, "waitingTargets">,
  sourceRunId: string,
  owners: readonly string[],
): Promise<boolean> {
  const pending = [...owners];
  const seen = new Set<string>();
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (id === sourceRunId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(await invocations.waitingTargets(id)));
  }
  return false;
}

const QUIET_CHECK_MS = 250;

function isOutgoingJump(active: ActivePlanRun, nodeId: string): boolean {
  return active.snapshot.plan.nodes.some(
    (node) =>
      node.id === nodeId && node.type === "jump" && node.direction === "out",
  );
}

function otherWork(active: ActivePlanRun, nodeId: string): readonly string[] {
  return [...active.controllers.keys()].filter((id) => id !== nodeId);
}

async function quiesceForHandover(
  active: ActivePlanRun,
  nodeId: string,
  options: { readonly signal: AbortSignal; readonly deadline: number | null },
): Promise<void> {
  active.isHandingOver = true;
  for (;;) {
    if (options.signal.aborted) throw new AgentPlanCancelledError();
    const others = otherWork(active, nodeId);
    const pendingResults = active.branching?.pending.length ?? 0;
    if (others.length === 0 && pendingResults === 0) break;
    if (others.some((id) => isOutgoingJump(active, id)))
      throw new AgentError("plan_jump_handover_unavailable");
    if (options.deadline !== null && Date.now() >= options.deadline)
      throw new AgentError("plan_jump_handover_unavailable");
    await new Promise<void>((resolve) => {
      setTimeout(resolve, QUIET_CHECK_MS).unref();
    });
  }
  if (hasUnconfirmedRunCloseout(active.view))
    throw new AgentError("plan_jump_handover_unavailable");
}
