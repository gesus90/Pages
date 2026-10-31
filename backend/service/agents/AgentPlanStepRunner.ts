import { apiBusinessResult } from "./AgentPlanStepFailure";
import { randomUUID } from "node:crypto";

import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { agentToolFailureEvents } from "@/backend/service/agents/tools/AgentToolSession";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { AgentProviderError } from "@/backend/error/AgentProviderError";
import { isApiProvider } from "@/definition/AgentConnection";
import { isAcpProvider } from "@/definition/AgentConfiguration";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import { assetFailure } from "./AgentPlanStepFailure";
import { retiredPlanGroupSession } from "./AgentPlanGroupRetirement";
import { createPlanSessionObserver } from "./AgentPlanSessionObserver";
import { guardPlanStepStart } from "./AgentPlanStepDispatch";
import {
  errorCode,
  failureCloseout,
  planAcceptanceFailure,
} from "./AgentPlanStepFailure";
import { waitForTurn } from "./AgentPlanTurn";
import { offerGroupInstructions } from "./AgentPlanGroupInstructions";
import {
  loopSessionTerms,
  planSessionGroup,
  planSessionLink,
} from "./loop/AgentPlanLoopSession";
import {
  AgentPlanGroupSessions,
  type GroupSessionResume,
} from "./AgentPlanGroupSessions";
import { AgentPlanStepAssessment } from "./AgentPlanStepAssessment";
import { buildPlanContract } from "./AgentPlanContract";
import {
  buildPlanSessionInput,
  planRetryGroupResume,
} from "./AgentPlanSessionPrompt";
import { sanitizePlanOutput } from "./AgentPlanOutput";
import { runPlanNodeAttempts } from "./AgentPlanStepAttempts";
import { planSessionReach } from "./AgentPlanSessionAccess";
import { planRecoveryTerms } from "./recovery/AgentPlanRecoveryPrompt";
import {
  createSessionRecord,
  initialStepAttemptId,
  closedSessionChanges,
  hasPlanStepTimedOut,
  isConfirmedPlanCancellation,
  planCompletedFailure,
  turnFailureCode,
  withTurn,
} from "./AgentPlanSessionRecords";

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
import type { AgentRunArchive } from "./AgentRunArchive";
import type { AgentSessionService } from "./sessions/AgentSessionService";
import type { NodeRun, StepRunControl } from "./AgentPlanStepContext";

export type { StepRunControl } from "./AgentPlanStepContext";

interface StepRunnerDependencies {
  readonly start: Pick<AgentPlanStepStart, "prepare"> &
    Partial<Pick<AgentPlanStepStart, "prepareGroup">>;
  readonly execution: PlanExecution;
  readonly tasks: Pick<AgentPlanTasks, "checklist">;
  readonly access: Pick<AgentPlanSessionAccess, "grant" | "revoke">;
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
  private readonly assessment: AgentPlanStepAssessment;
  private readonly retained = new Map<string, NodeRun[]>();
  private readonly groupInputs = new Map<string, Promise<AgentPlanSnapshot>>();

  public constructor(dependencies: StepRunnerDependencies) {
    this.dependencies = dependencies;
    this.groups = new AgentPlanGroupSessions(dependencies.execution);
    this.assessment = new AgentPlanStepAssessment(dependencies.tasks);
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
    const previous = run.steps.find(
      (result) => result.id === step.step.id,
    )?.session;
    const loop = loopSessionTerms(step, snapshot, control.iteration);
    const node: NodeRun = {
      run,
      snapshot,
      step,
      control,
      record: previous?.retry ? previous : null,
      hasStarted: false,
      retry: previous?.retry ?? null,
      retryResumeSessionId: null,
      retryAttemptNumber: 1,
      retryGroup: null,
      loop,
      sessionGroup: planSessionGroup(step, loop),
    };
    // The place in the group's queue is taken before any await, in the order the engine starts its members.
    const slot = node.sessionGroup
      ? this.groups.reserve(`${run.id}/${node.sessionGroup}`)
      : null;
    try {
      if (slot) await waitForTurn(slot.ready, control.signal);
      return await runPlanNodeAttempts(node, {
        execute: () => this.execute(node),
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
  public revise(runId: string): void {
    for (const key of this.groupInputs.keys())
      if (key.startsWith(`${runId}/`)) this.groupInputs.delete(key);
  }

  /** Ends retained native sessions when the plan is cancelled or finishes. */
  public async closeGroups(runId: string, groupId?: string): Promise<void> {
    await this.closeSessionGroups(runId, groupId);
  }

  /** Ends the sessions of a group or loop agent, or of the whole run, and tells how each one closed. */
  private async closeSessionGroups(
    runId: string,
    groupId?: string,
  ): Promise<Awaited<ReturnType<AgentPlanGroupSessions["stop"]>>> {
    const stopped = await this.groups.stop(runId, groupId);
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
    const prepared = await this.dependencies.start.prepare(
      node.run,
      node.snapshot,
      node.step,
    );
    if (node.control.signal.aborted) throw new AgentPlanCancelledError();
    if (prepared.options.timeoutMinutes > 0)
      node.control = {
        ...node.control,
        signal: AbortSignal.any([
          node.control.signal,
          AbortSignal.timeout(prepared.options.timeoutMinutes * 60_000),
        ]),
      };
    const guarded = guardPlanStepStart(node, prepared);
    if (isApiProvider(prepared.input.agent.connection.provider))
      return this.request(node, guarded);
    return this.session(node, guarded);
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
    await this.save(node, {
      ...createSessionRecord({
        attemptId: initialStepAttemptId(node),
        instanceId: randomUUID(),
        prepared,
        contract: null,
        usesMcp: false,
      }),
      startedAt: new Date().toISOString(),
    });
    const recovery = planRecoveryTerms(node.snapshot, node.step.step.id, node);
    const input = {
      ...prepared.input,
      prompt: recovery.note + prepared.input.prompt,
    };
    await this.pin(node, input.prompt);
    const output = sanitizePlanOutput(
      await this.dependencies.execution.run(input, node.control.signal),
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
    const { run, step, snapshot } = node;
    const directory = prepared.input.directory;
    if (directory === null) throw new AgentError("plan_directory_required");
    const tickets = await Promise.all(
      step.taskIds.map((taskId) =>
        this.dependencies.tasks.checklist(
          run.userId,
          snapshot.plan.projectId,
          taskId,
        ),
      ),
    );
    const reach = planSessionReach(
      prepared.input.agent.connection.provider,
      prepared.options,
    );
    const isReadOnly = reach === "read";
    const instruction = prepared.instruction ?? step.step.instruction;
    const contract = buildPlanContract(instruction, tickets, {
      isReadOnly,
      completion: step.step.completion,
      completionGate: step.step.completionGate,
    });
    const groupKey = `${run.id}/${node.sessionGroup ?? step.step.id}`;
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
      ...this.sessionLink(node, prepared, groupKey, groupResume),
    });
    const mcp = this.groups.instanceId(groupKey)
      ? this.groups.mcp(groupKey)
      : await this.dependencies.access.grant({
          userId: run.userId,
          runId: run.id,
          stepId: node.sessionGroup ?? step.step.id,
          tickets: contract.tickets,
          lifetimeMs: node.sessionGroup
            ? 0
            : prepared.options.timeoutMinutes * 60_000,
          reach,
          canSetStatus: step.step.completion === "todos",
        });
    const input = await buildPlanSessionInput(
      node,
      prepared,
      { contract, mcp, instanceId },
      {
        pin: (prompt) => this.pin(node, prompt),
        journal: (id) => this.dependencies.sessions?.listen(node, id),
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
    this.offerInstructions(node, groupKey, input);
    node.hasStarted = true;
    try {
      return await this.finish(node, session, { contract, reach, instruction });
    } catch (error: unknown) {
      logCaughtError("AgentPlanStepRunner", error);

      // A started session is always ended, also when its evaluation failed.
      await session.close().catch((closeError: unknown) => {
        logCaughtError("AgentPlanStepRunner", closeError);

        logDiagnostic(
          "AgentPlanStepRunner",
          "error",
          "Pages could not close an agent session.",
          closeError,
        );
      });
      throw error;
    }
  }

  /** Lets the executor instruct a group member's open session through the group's queue. */
  private offerInstructions(
    node: NodeRun,
    key: string,
    input: AgentPlanSessionInput,
  ): void {
    const { sessions } = this.dependencies;
    if (!sessions || !node.step.groupId) return;
    offerGroupInstructions({ sessions, groups: this.groups, node, key, input });
  }

  /** Records whether a member opens its group's or loop's session or continues it. */
  private sessionLink(
    node: NodeRun,
    prepared: PreparedPlanStep,
    groupKey: string,
    resume?: GroupSessionResume,
  ): Pick<AgentPlanSessionRecord, "group" | "loop"> {
    const provider = prepared.input.agent.connection.provider;
    if (!isAcpProvider(provider)) return {};
    const shared = node.sessionGroup
      ? this.groups.link(
          groupKey,
          {
            groupId: node.sessionGroup,
            stepId: node.step.step.id,
            adapter: provider,
          },
          resume,
        )
      : null;
    return planSessionLink(node, shared);
  }

  private async finish(
    node: NodeRun,
    session: PlanSession,
    terms: AgentPlanSessionTerms,
  ): Promise<Partial<AgentPlanStepResult>> {
    const turn = await session.turn;
    if (node.record) node.record = withTurn(node.record, turn);
    await this.dependencies.sessions?.settle(node.record, turn);
    const assessed =
      turn.failure === null && turn.errorCode === null
        ? await this.assessment.assess(terms, turn.output, {
            userId: node.run.userId,
            projectId: node.snapshot.plan.projectId,
            provider: node.step.provider,
          })
        : null;
    const acceptance = assessed?.acceptance ?? null;
    const acceptanceFailure = planAcceptanceFailure(node, acceptance);
    // The closing report and the verdict are kept before the session is ended.
    await this.complete(node, {
      acceptance,
      ...(assessed ? { contract: assessed.contract } : {}),
    });
    if (!acceptanceFailure && this.retain(node, turn))
      return {
        status: "succeeded",
        output: sanitizePlanOutput(turn.output),
        error: null,
        session: node.record,
      };
    const closed = await this.closeSession(node, session);
    const failure =
      planCompletedFailure(turn, closed, node.control.signal) ??
      acceptanceFailure;
    await this.complete(node, {
      ...closedSessionChanges(closed),
      resultCode: failure === null ? 0 : -1,
    });
    const output = sanitizePlanOutput(turn.output);
    if (isConfirmedPlanCancellation(turn, closed, node.control.signal))
      return {
        status: "cancelled",
        cancellation: "confirmed",
        output,
        session: node.record,
      };
    return failure === null
      ? { status: "succeeded", output, error: null, session: node.record }
      : { status: "failed", output, error: failure, session: node.record };
  }

  private retain(node: NodeRun, turn: PlanSessionTurn): boolean {
    // Retain until every actual member has succeeded, independent of chain or
    // membership order. A later frontier may return from outside the frame.
    if (turnFailureCode(turn) !== null || node.control.signal.aborted)
      return false;
    const group = node.snapshot.groups?.find(
      (entry) => entry.id === node.step.groupId,
    );
    // A loop keeps the session of each agent open until the loop itself ends or fails.
    if (!group && node.loop?.policy !== "reuse") return false;
    const key = `${node.run.id}/${group?.id ?? node.sessionGroup}`;
    const nodes = this.retained.get(key) ?? [];
    const completed = new Set([
      ...nodes.map((entry) => entry.step.step.id),
      node.step.step.id,
    ]);
    if (group?.steps.every((step) => completed.has(step.id))) return false;
    this.retained.set(key, [...nodes, node]);
    return true;
  }

  private async closeSession(
    node: NodeRun,
    session: PlanSession,
  ): Promise<PlanSessionClosed> {
    const key = `${node.run.id}/${node.sessionGroup ?? node.step.step.id}`;
    const closed = await session.close();
    await this.dependencies.sessions?.released(node.record);
    this.groupInputs.delete(key);
    for (const previous of this.retained.get(key) ?? [])
      await this.complete(previous, closedSessionChanges(closed));
    this.retained.delete(key);
    await this.dependencies.access.revoke(
      node.run.id,
      node.sessionGroup ?? node.step.step.id,
    );
    return closed;
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
      ? await this.closeSessionGroups(node.run.id, node.sessionGroup)
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
    if (node.record?.closeout === "failed")
      return {
        status: "failed",
        error: "plan_closeout_failed",
        session: node.record,
      };
    if (hasPlanStepTimedOut(node.control.signal))
      return { status: "failed", error: "timeout", session: node.record };
    if (error instanceof AgentPlanCancelledError)
      return {
        status: "cancelled",
        cancellation: node.hasStarted ? "confirmed" : "not_started",
        session: node.record,
      };
    return {
      status: "failed",
      error: errorCode(error),
      session: node.record,
      ...assetFailure(error),
    };
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
