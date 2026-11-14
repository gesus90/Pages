import { randomUUID } from "node:crypto";

import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { agentToolFailureEvents } from "@/backend/service/agents/tools/AgentToolSession";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { AgentProviderError } from "@/backend/error/AgentProviderError";
import { isApiProvider } from "@/definition/AgentConnection";
import { logCaughtError } from "@/backend/logging/Logger";

import { planTurnTimeout } from "./AgentPlanTimeout";
import {
  planStepProgress,
} from "./AgentPlanTurnControl";
import { planPauseGate } from "./AgentPlanPauseGate";
import { runPausablePlanRequest } from "./AgentPlanPausedRequest";
import {
  closePlanSession,
  finishStartedPlanSession,
  planSessionCloseoutFailure,
} from "./AgentPlanSessionCloseout";
import { retainPlanSession } from "./AgentPlanRetainedSessions";
import {
  apiBusinessResult,
  planNodeFailureResult,
} from "./AgentPlanStepFailure";
import {
  reattachLocalStep,
  restoreLocalStepSessions,
} from "./AgentPlanLocalSessions";
import { retiredPlanGroupSession } from "./AgentPlanGroupRetirement";
import { createPlanSessionObserver } from "./AgentPlanSessionObserver";
import { guardPlanStepStart } from "./AgentPlanStepDispatch";
import { failureCloseout, planAcceptanceOutcome } from "./AgentPlanStepFailure";
import { waitForTurn } from "./AgentPlanTurn";
import {
  offerGroupInstructions,
  offerTurnInput,
} from "./AgentPlanGroupInstructions";
import { planSharedSessionLink } from "./AgentPlanSharedSessionLink";
import { createNodeRun } from "./AgentPlanNodeRun";
import { openEventTurn } from "./branching/AgentPlanEventSession";
import { AgentPlanGroupSessions } from "./AgentPlanGroupSessions";
import { AgentPlanTurnReports } from "./AgentPlanTurnReports";
import { runPlanTodoTurns } from "./AgentPlanTodoContinuation";
import {
  buildSessionContract,
  initializeSessionTodos,
} from "./AgentPlanSessionContract";
import {
  buildPlanSessionInput,
  planRequestPrompt,
  planRetryGroupResume,
} from "./AgentPlanSessionPrompt";
import { sanitizePlanOutput } from "./AgentPlanOutput";
import { runPlanNodeAttempts } from "./AgentPlanStepAttempts";
import {
  createSessionRecord,
  initialStepAttemptId,
  closedSessionChanges,
  isConfirmedPlanCancellation,
} from "./AgentPlanSessionRecords";
import { planStackNodeInput } from "./stack/AgentPlanStackInputs";

import type {
  AgentPlanSessionInput,
  PlanExecution,
  PlanSession,
  PlanSessionObserver,
  PlanSessionTurn,
  PlanSessionClosed,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { AgentPlanSessionAccess } from "./AgentPlanSessionAccess";
import type {
  AgentPlanSnapshot,
  AgentPlanStepSnapshot,
} from "./AgentPlanSnapshot";
import type {
  AgentPlanStepStart,
  PreparedPlanStep,
} from "./AgentPlanStepStart";
import type { AgentPlanTasks } from "./AgentPlanTasks";
import type { AgentPlanSessionTerms } from "./AgentPlanStepAssessment";
import type { AgentPlanStepReportService } from "./AgentPlanStepReportService";
import type { AgentPlanStepProgressService } from "./AgentPlanStepProgressService";
import type { AgentRunArchive } from "./AgentRunArchive";
import type { AgentSessionService } from "./sessions/AgentSessionService";
import type { NodeRun, StepRunControl } from "./AgentPlanStepContext";
import type { LocalSessions } from "@/backend/agents/local/LocalSessions";

export type { StepRunControl } from "./AgentPlanStepContext";

interface StepRunnerDependencies {
  readonly localSessions?: LocalSessions;
  readonly start: Pick<AgentPlanStepStart, "prepare"> &
    Partial<Pick<AgentPlanStepStart, "prepareGroup">>;
  readonly execution: PlanExecution;
  readonly tasks: Pick<AgentPlanTasks, "checklist"> &
    Partial<Pick<AgentPlanTasks, "snapshot">>;
  readonly access: Pick<AgentPlanSessionAccess, "grant" | "revoke">;
  /** Takes what a session reports through `report_step_result`. */
  readonly stepReports?: Pick<AgentPlanStepReportService, "open" | "close">;
  /** The live progress of a step, which a new session after a failure continues from (PAGE-284). */
  readonly stepProgress?: Pick<AgentPlanStepProgressService, "find"> &
    Partial<Pick<AgentPlanStepProgressService, "initialize" | "current">>;
  readonly archive?: Pick<AgentRunArchive, "input">;
  /** Records the PageAgentCLI history and usage of every ACP node. */
  readonly sessions?: Pick<
    AgentSessionService,
    "listen" | "settle" | "released" | "offer" | "abandon"
  >;
}

/**
 * Runs one agent node: request or session, acceptance, closeout and result code.
 *
 * @remarks
 * The record of the node, with the requested configuration, the todo list and
 * the acceptance criteria, is stored before any process starts, and the sent
 * prompt is pinned before it leaves. Regular runner completion and a clean,
 * confirmed closeout determine execution success. Business progress and process
 * evidence are stored separately. Every agent requires accepted business
 * progress before successors start.
 */
export class AgentPlanStepRunner {
  private readonly dependencies: StepRunnerDependencies;
  private readonly groups: AgentPlanGroupSessions;
  private readonly turnReports: AgentPlanTurnReports;
  private readonly retained = new Map<string, NodeRun[]>();
  private readonly groupInputs = new Map<string, Promise<AgentPlanSnapshot>>();

  public constructor(dependencies: StepRunnerDependencies) {
    this.dependencies = dependencies;
    this.groups = new AgentPlanGroupSessions(dependencies.execution);
    this.turnReports = new AgentPlanTurnReports(
      dependencies.stepReports,
      dependencies.tasks,
      dependencies.stepProgress?.current
        ? {
            current: dependencies.stepProgress.current.bind(
              dependencies.stepProgress,
            ),
          }
        : undefined,
    );
  }

  /**
   * Runs the node and returns the changes of its step result.
   *
   * @param run - The current view of the plan run.
   * @param snapshot - The frozen plan.
   * @param step - The frozen node.
   * @param control - The stop signal and the persistence of the record.
   * @returns Status, output, error, cancellation and the record of the node.
   */
  public async run(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    step: AgentPlanStepSnapshot,
    control: StepRunControl,
  ): Promise<Partial<AgentPlanStepResult>> {
    control.awaitDispatch?.();
    const node = createNodeRun(run, snapshot, step, control);
    let shouldReattach = true;
    // The place in the group's queue is taken before any await, in the order the engine starts its members.
    const slot = node.sessionGroup
      ? this.groups.reserve(`${run.id}/${node.sessionGroup}`)
      : null;
    try {
      if (slot) await waitForTurn(slot.ready, control.signal);
      return await runPlanNodeAttempts(node, {
        execute: () => {
          const reattached = shouldReattach
            ? reattachLocalStep(node, {
                local: this.dependencies.localSessions,
                observer: (restored) => this.observer(restored),
                finish: (restored, session, terms) =>
                  this.finish(restored, session, terms),
              })
            : null;
          shouldReattach = false;
          return reattached ?? this.execute(node);
        },
        failure: (error) => this.failure(node, error),
        paused: () => this.pauseUnstarted(node),
        save: (changes) => this.complete(node, changes),
      });
    } catch (error: unknown) {
      logCaughtError("AgentPlanStepRunner", error);
      if (control.signal.reason instanceof AgentPlanPausedError)
        return this.pauseUnstarted(node);
      return this.failure(node, error);
    } finally {
      slot?.release();
    }
  }

  /** Refreshes shared inputs after adoption while preserving the existing native sessions. */
  public async restore(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    save: (record: AgentPlanSessionRecord) => Promise<void>,
    control: {
      readonly instruction?: NonNullable<StepRunControl["runInstruction"]>;
      readonly trackInstruction?: (
        instanceId: string,
        pending: PlanSession["turn"],
      ) => void;
    } = {},
  ): Promise<void> {
    await restoreLocalStepSessions(run, snapshot, {
      local: this.dependencies.localSessions,
      groups: this.groups,
      retained: this.retained,
      groupInputs: this.groupInputs,
      save,
      observer: (node) => this.observer(node),
      start: this.dependencies.start,
      ...control,
      offer: (node, key, input) => this.offerInstructions(node, key, input),
    });
  }

  /** Refreshes shared inputs after adoption while preserving the existing native sessions. */
  public revise(runId: string): void {
    for (const key of this.groupInputs.keys())
      if (key.startsWith(`${runId}/`)) this.groupInputs.delete(key);
  }

  /** Ends retained native sessions when the plan is cancelled or finishes. */
  public async closeGroups(runId: string, groupId?: string): Promise<void> {
    await this.closeSessionGroups(runId, groupId);
  }

  /** Releases the local session owners after all native sessions have closed; transcripts stay. */
  public async finishPlanRun(
    runId: string,
    status: "succeeded" | "failed" | "cancelled",
  ): Promise<void> {
    if (status === "cancelled")
      await this.dependencies.access.revoke(runId, null);
    await this.dependencies.execution.finishPlanRun?.(runId, status);
  }

  /** Ends the sessions of a group or loop agent, or of the whole run, and tells how each one closed. */
  private async closeSessionGroups(
    runId: string,
    groupId?: string,
    options?: { readonly abort?: boolean },
  ): Promise<Awaited<ReturnType<AgentPlanGroupSessions["stop"]>>> {
    const stopped = await this.groups.stop(runId, groupId, options);
    if (groupId === undefined) this.groups.forget(runId);
    for (const { key, closed } of stopped) {
      for (const node of this.retained.get(key) ?? []) {
        await this.dependencies.sessions?.released(node.record);
        await this.complete(node, closedSessionChanges(closed));
      }
      this.retained.delete(key);
      await this.dependencies.access.revoke(runId, key.slice(runId.length + 1));
    }
    for (const key of this.groupInputs.keys())
      if (
        key === `${runId}/${groupId}` ||
        (!groupId && key.startsWith(`${runId}/`))
      )
        this.groupInputs.delete(key);
    return stopped;
  }

  private async execute(node: NodeRun): Promise<Partial<AgentPlanStepResult>> {
    await this.prepareGroup(node);
    node.step = await planStackNodeInput(node, this.dependencies.tasks);
    const prepared = await this.dependencies.start.prepare(
      node.run,
      node.snapshot,
      node.step,
    );
    if (node.control.signal.aborted) throw new AgentPlanCancelledError();
    const timeout = planTurnTimeout(
      node.run.id,
      prepared.options.timeoutMinutes * 60_000,
      node.control.signal,
    );
    node.control = { ...node.control, signal: timeout.signal };
    try {
      await planPauseGate(node.run.id).wait(node.control.signal);
      const guarded = guardPlanStepStart(node, prepared);
      if (isApiProvider(prepared.input.agent.connection.provider))
        return await this.request(node, guarded);
      return await this.session(node, guarded);
    } finally {
      timeout.dispose();
    }
  }

  private async pauseUnstarted(
    node: NodeRun,
  ): Promise<Partial<AgentPlanStepResult>> {
    const group = node.sessionGroup;
    const retained = group && this.groups.instanceId(`${node.run.id}/${group}`);
    if (node.record && !retained)
      await this.dependencies.access.revoke(
        node.run.id,
        group ?? node.step.step.id,
      );
    return {
      status: "paused",
      session: node.retry ? node.record : null,
      error: null,
    };
  }

  private async prepareGroup(node: NodeRun): Promise<void> {
    const groupId = node.step.groupId;
    if (!groupId) return;
    const key = `${node.run.id}/${groupId}`;
    let inputs = this.groupInputs.get(key);
    if (!inputs) {
      if (!this.dependencies.start.prepareGroup)
        throw new AgentError("plan_group_session_unsupported");
      inputs = this.dependencies.start.prepareGroup(
        node.run,
        node.snapshot,
        groupId,
      );
      this.groupInputs.set(key, inputs);
    }
    node.snapshot = await inputs;
    const step = node.snapshot.steps.find(
      (entry) => entry.step.id === node.step.step.id,
    );
    if (!step) throw new AgentError("plan_binding_invalid");
    node.step = step;
  }

  private async request(
    node: NodeRun,
    prepared: PreparedPlanStep,
  ): Promise<Partial<AgentPlanStepResult>> {
    const previous = node.run.steps.find(
      (step) => step.id === node.step.step.id,
    )?.session;
    await this.save(node, {
      ...createSessionRecord({
        attemptId: previous?.attemptId ?? initialStepAttemptId(node),
        instanceId: previous?.instanceId ?? randomUUID(),
        prepared,
        contract: null,
        usesMcp: false,
      }),
      startedAt: new Date().toISOString(),
    });
    const input = {
      ...prepared.input,
      prompt: planRequestPrompt(node, prepared),
      // Names the run and node, so result files a request writes keep their origin.
      resourceContext: { runId: node.run.id, stepId: node.step.step.id },
    };
    await this.pin(node, input.prompt);
    const output = sanitizePlanOutput(
      await runPausablePlanRequest(node.run.id, node.control.signal, (signal) =>
        this.dependencies.execution.run(input, signal),
      ),
    );
    const result = apiBusinessResult(output);
    await this.complete(node, {
      endedAt: new Date().toISOString(),
      resultCode: result.status === "failed" ? -1 : 0,
    });
    return { ...result, session: node.record };
  }

  private async session(
    node: NodeRun,
    prepared: PreparedPlanStep,
  ): Promise<Partial<AgentPlanStepResult>> {
    const { run, step } = node;
    if (prepared.input.directory === null)
      throw new AgentError("plan_directory_required");
    const initialTerms = await buildSessionContract(
      node,
      prepared,
      this.dependencies.tasks,
    );
    const { reach, instruction } = initialTerms;
    let { contract } = initialTerms;
    const groupKey = `${run.id}/${node.sessionGroup ?? step.step.id}`;
    await openEventTurn(this.groups, node, groupKey);
    const instanceId = this.groups.instanceId(groupKey) ?? randomUUID();
    const groupResume = planRetryGroupResume(node);
    await this.save(node, {
      ...createSessionRecord({
        attemptId: initialStepAttemptId(node),
        instanceId,
        prepared,
        contract,
        usesMcp: reach !== "tickets" || contract.tickets.length > 0,
      }),
      todoReturns: node.todoReturns ?? 0,
      ...planSharedSessionLink(node, prepared, {
        groups: this.groups,
        key: groupKey,
        resume: groupResume,
      }),
    });
    contract = await initializeSessionTodos(
      node,
      contract,
      this.dependencies.stepProgress,
    );
    await this.complete(node, { contract });
    const mcp = this.groups.instanceId(groupKey)
      ? this.groups.mcp(groupKey)
      : await this.dependencies.access.grant({
          userId: run.userId,
          runId: run.id,
          stepId: node.sessionGroup ?? step.step.id,
          instanceId,
          tickets: contract.tickets,
          lifetimeMs: node.sessionGroup
            ? 0
            : prepared.options.timeoutMinutes * 60_000,
          reach,
          canSetStatus: step.step.completion === "todos",
        });
    const terms = { contract, reach, instruction };
    if (mcp) await this.turnReports.open(node, prepared, terms);
    const input = await buildPlanSessionInput(
      node,
      prepared,
      { contract, mcp, instanceId },
      {
        pin: (prompt) => this.pin(node, prompt),
        progress: () => planStepProgress(node, this.dependencies.stepProgress),
        journal: (id) =>
          this.dependencies.execution.hasDurableLocalSessions
            ? undefined
            : this.dependencies.sessions?.listen(node, id),
      },
    );
    const session = node.sessionGroup
      ? await this.groups.turn(
          {
            key: groupKey,
            input,
            signal: node.control.signal,
            observer: this.observer(node),
          },
          groupResume,
        )
      : await this.dependencies.execution.open(
          input,
          node.control.signal,
          this.observer(node),
        );
    node.control.claimStart?.();
    this.offerInstructions(node, groupKey, input, session);
    node.hasStarted = true;
    return finishStartedPlanSession(session, () =>
      this.finish(node, session, terms),
    );
  }

  /**
   * Lets the executor instruct a group member's open session through the
   * group's queue, or type into the running turn of a single node (PAGE-284).
   */
  private offerInstructions(
    node: NodeRun,
    key: string,
    input: AgentPlanSessionInput | (() => Promise<AgentPlanSessionInput>),
    session?: PlanSession,
  ): void {
    const { sessions } = this.dependencies;
    if (!sessions) return;
    if (!node.step.groupId) {
      if (session) offerTurnInput(sessions, node, session);
      return;
    }
    offerGroupInstructions({ sessions, groups: this.groups, node, key, input });
  }

  private async finish(
    node: NodeRun,
    session: PlanSession,
    terms: AgentPlanSessionTerms,
  ): Promise<Partial<AgentPlanStepResult>> {
    const reportedTurns = await runPlanTodoTurns(
      { node, session, terms },
      {
        reports: this.turnReports,
        start: this.dependencies.start,
        sessions: this.dependencies.sessions,
        hasDurableLocalSessions:
          this.dependencies.execution.hasDurableLocalSessions,
        observer: this.observer(node),
        save: (changes) => this.complete(node, changes),
        close: () => this.closeSession(node, session),
      },
    );
    if (!reportedTurns)
      return planNodeFailureResult(node, new AgentPlanCancelledError());
    const { assessed, output, turn } = reportedTurns;
    const acceptance = assessed?.acceptance ?? null;
    const outcome = planAcceptanceOutcome(node, acceptance);
    const acceptanceFailure = outcome.failure;
    const passed =
      outcome.passed === undefined ? {} : { passed: outcome.passed };
    if (!acceptanceFailure && this.retain(node, turn))
      return {
        status: "succeeded",
        output,
        error: null,
        session: node.record,
        ...passed,
      };
    const closeout = await this.closeSession(node, session);
    const { closed } = closeout;
    const failure =
      planSessionCloseoutFailure(turn, closeout, node.control.signal) ??
      acceptanceFailure;
    await this.complete(node, {
      ...closedSessionChanges(closed),
      resultCode: failure === null ? 0 : -1,
    });
    if (isConfirmedPlanCancellation(turn, closed, node.control.signal))
      return {
        status: "cancelled",
        cancellation: "confirmed",
        output,
        session: node.record,
      };
    return failure === null
      ? {
          status: "succeeded",
          output,
          error: null,
          session: node.record,
          ...passed,
        }
      : { status: "failed", output, error: failure, session: node.record };
  }

  private retain(node: NodeRun, turn: PlanSessionTurn): boolean {
    return retainPlanSession(node, turn, this.retained);
  }

  private async closeSession(
    node: NodeRun,
    session: PlanSession,
  ): ReturnType<typeof closePlanSession> {
    const key = `${node.run.id}/${node.sessionGroup ?? node.step.step.id}`;
    const closeout = await closePlanSession(session, node.record);
    const { closed } = closeout;
    await this.dependencies.sessions?.released(node.record);
    this.groupInputs.delete(key);
    for (const previous of this.retained.get(key) ?? [])
      await this.complete(previous, closedSessionChanges(closed));
    this.retained.delete(key);
    await this.dependencies.access.revoke(
      node.run.id,
      node.sessionGroup ?? node.step.step.id,
    );
    return closeout;
  }

  private observer(node: NodeRun): PlanSessionObserver {
    const observer = createPlanSessionObserver(node, (changes) =>
      this.complete(node, changes),
    );
    if (!node.sessionGroup) return observer;
    return {
      ...observer,
      retired: (closed, reason) => {
        void this.retireGroup(node, closed, reason).catch((error: unknown) => {
          logCaughtError("AgentPlanStepRunner", error);
        });
      },
    };
  }

  private async retireGroup(
    node: NodeRun,
    closed: PlanSessionClosed,
    reason: string,
  ): Promise<void> {
    const key = `${node.run.id}/${node.sessionGroup}`;
    const previous = this.retained.get(key) ?? [];
    const members = previous.includes(node) ? previous : [...previous, node];
    for (const member of members)
      await this.complete(
        member,
        retiredPlanGroupSession(member.record, closed, reason),
      );
    await this.dependencies.sessions?.released(node.record);
    await this.dependencies.access.revoke(
      node.run.id,
      node.sessionGroup ?? node.step.step.id,
    );
    this.retained.delete(key);
    this.groupInputs.delete(key);
  }

  private async failure(
    node: NodeRun,
    error: unknown,
  ): Promise<Partial<AgentPlanStepResult>> {
    const stopped = node.sessionGroup
      ? await this.closeSessionGroups(node.run.id, node.sessionGroup, {
          abort: true,
        })
      : [];
    await this.dependencies.access.revoke(
      node.run.id,
      node.sessionGroup ?? node.step.step.id,
    );
    await this.dependencies.sessions?.abandon(
      node.record,
      error instanceof AgentPlanCancelledError ? "cancelled" : "failed",
    );
    if (node.record)
      await this.complete(node, {
        ...(error instanceof AgentProviderError
          ? { providerFailure: error.failure }
          : {}),
        endedAt: new Date().toISOString(),
        closeout: failureCloseout(node, error, stopped.at(0)?.closed),
        resultCode: -1,
        events: agentToolFailureEvents(error, node.record.events),
      });
    return planNodeFailureResult(node, error);
  }

  private async pin(node: NodeRun, prompt: string): Promise<void> {
    await this.complete(node, {
      dispatchedPromptDigest: planContentDigest(prompt),
    });
    await this.dependencies.archive?.input(
      node.run.id,
      node.step.step.id,
      prompt,
    );
    if (node.control.signal.aborted) throw new AgentPlanCancelledError();
  }

  private async complete(
    node: NodeRun,
    changes: Partial<AgentPlanSessionRecord>,
  ): Promise<void> {
    if (!node.record) return;
    await this.save(node, { ...node.record, ...changes });
  }

  private async save(
    node: NodeRun,
    record: AgentPlanSessionRecord,
  ): Promise<void> {
    node.record = node.retry ? { ...record, retry: node.retry } : record;
    await node.control.save(node.record);
  }
}
