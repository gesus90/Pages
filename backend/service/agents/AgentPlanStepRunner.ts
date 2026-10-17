import { randomUUID } from "node:crypto";

import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { agentToolFailureEvents } from "@/backend/service/agents/tools/AgentToolSession";
import { AgentError } from "@/backend/error/AgentErrors";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { isApiProvider } from "@/definition/AgentConnection";
import { isAcpProvider } from "@/definition/AgentConfiguration";
import { planGroupOrder } from "@/definition/AgentPlanGroup";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import { waitForTurn } from "./AgentPlanTurn";
import { offerGroupInstructions } from "./AgentPlanGroupInstructions";
import { AgentPlanGroupSessions } from "./AgentPlanGroupSessions";
import { AgentPlanStepAssessment } from "./AgentPlanStepAssessment";
import { buildPlanContract, renderPlanAssignment } from "./AgentPlanContract";
import { sanitizePlanOutput } from "./AgentPlanOutput";
import { planSessionReach } from "./AgentPlanSessionAccess";
import {
  createSessionRecord,
  closeoutFailureCode,
  hasPlanStepTimedOut,
  isConfirmedPlanCancellation,
  planCompletedFailure,
  runnerLabel,
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
import type {
  AgentPlanAcceptance,
  AgentPlanContract,
  AgentPlanSessionRecord,
} from "@/definition/AgentPlanSession";
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

/** How a running node reports its record and learns about a stop. */
export interface StepRunControl {
  readonly signal: AbortSignal;
  /** Persists the newest record of the node; never throws. */
  readonly save: (session: AgentPlanSessionRecord) => Promise<void>;
}

/** One node from its start to its result; `record` always holds the newest state. */
interface NodeRun {
  readonly run: AgentPlanRun;
  snapshot: AgentPlanSnapshot;
  step: AgentPlanStepSnapshot;
  control: StepRunControl;
  record: AgentPlanSessionRecord | null;
  hasStarted: boolean;
}

function errorCode(error: unknown): string {
  if (error instanceof AgentError || error instanceof TextAssistantError)
    return error.code;
  return "plan_step_failed";
}

function failureCloseout(
  node: NodeRun,
  error: unknown,
): AgentPlanSessionRecord["closeout"] {
  if (
    error instanceof AcpCleanupUnconfirmedError ||
    (node.hasStarted && node.record?.closeout === "pending")
  )
    return "failed";
  const closeout = node.record?.closeout ?? "not_needed";
  return closeout === "pending" ? "not_needed" : closeout;
}

function planAcceptanceFailure(
  node: NodeRun,
  acceptance: AgentPlanAcceptance | null,
): "plan_group_acceptance_failed" | "opencode_acceptance_failed" | null {
  if (acceptance?.verdict === "accepted") return null;
  if (node.step.groupId) return "plan_group_acceptance_failed";
  return node.step.provider === "opencode"
    ? "opencode_acceptance_failed"
    : null;
}

function requiresAcceptance(step: AgentPlanStepSnapshot): boolean {
  return Boolean(step.groupId) || step.provider === "opencode";
}

/**
 * Runs one agent node: request or session, acceptance, closeout and result code.
 *
 * @remarks
 * The record of the node, with the requested configuration, the todo list and
 * the acceptance criteria, is stored before any process starts, and the sent
 * prompt is pinned before it leaves. Regular runner completion and a clean,
 * confirmed closeout determine execution success. Business progress and report
 * diagnostics are stored separately. OpenCode nodes and all group members
 * additionally require accepted business progress before successors start.
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
    const node: NodeRun = {
      run,
      snapshot,
      step,
      control,
      record: null,
      hasStarted: false,
    };
    // The place in the group's queue is taken before any await, in the order the engine starts its members.
    const slot = step.groupId
      ? this.groups.reserve(`${run.id}/${step.groupId}`)
      : null;
    try {
      if (slot) await waitForTurn(slot.ready, control.signal);
      return await this.execute(node);
    } catch (error: unknown) {
      logCaughtError("AgentPlanStepRunner", error);

      return this.failure(node, error);
    } finally {
      slot?.release();
    }
  }

  /** Ends retained native sessions when the plan is cancelled or finishes. */
  public async closeGroups(runId: string, groupId?: string): Promise<void> {
    const stopped = await this.groups.stop(runId, groupId);
    if (groupId === undefined) this.groups.forget(runId);
    for (const { key, closed } of stopped) {
      for (const node of this.retained.get(key) ?? []) {
        await this.dependencies.sessions?.released(node.record);
        await this.complete(node, {
          closeout: closed.isConfirmed ? "confirmed" : "failed",
          exit: closed.exit,
          leftoverProcesses: closed.leftovers,
          endedAt: closed.endedAt,
          resultCode: closeoutFailureCode(closed) === null ? 0 : -1,
        });
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
    if (isApiProvider(prepared.input.agent.connection.provider))
      return this.request(node, prepared);
    return this.session(node, prepared);
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
        instanceId: randomUUID(),
        prepared,
        contract: null,
        usesMcp: false,
      }),
      startedAt: new Date().toISOString(),
    });
    await this.pin(node, prepared.input.prompt);
    node.hasStarted = true;
    const output = sanitizePlanOutput(
      await this.dependencies.execution.run(
        prepared.input,
        node.control.signal,
      ),
    );
    await this.complete(node, {
      endedAt: new Date().toISOString(),
      resultCode: 0,
    });
    return { status: "succeeded", output, error: null, session: node.record };
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
    const completion = step.step.completion ?? "report";
    const instruction = prepared.instruction ?? step.step.instruction;
    const contract = buildPlanContract(instruction, tickets, {
      isReadOnly,
      completion,
    });
    const groupKey = `${run.id}/${step.groupId ?? step.step.id}`;
    const instanceId = this.groups.instanceId(groupKey) ?? randomUUID();
    await this.save(node, {
      ...createSessionRecord({
        instanceId,
        prepared,
        contract,
        usesMcp: reach !== "tickets" || contract.tickets.length > 0,
      }),
      ...this.groupLink(node, prepared, groupKey),
    });
    const mcp = this.groups.instanceId(groupKey)
      ? this.groups.mcp(groupKey)
      : await this.dependencies.access.grant({
          userId: run.userId,
          runId: run.id,
          stepId: step.groupId ?? step.step.id,
          tickets: contract.tickets,
          lifetimeMs: step.groupId
            ? 0
            : prepared.options.timeoutMinutes * 60_000,
          reach,
          canSetStatus: completion === "todos",
        });
    const input = await this.sessionInput(node, prepared, {
      contract,
      mcp,
      instanceId,
    });
    const session = step.groupId
      ? await this.groups.turn({
          key: groupKey,
          input,
          signal: node.control.signal,
          observer: this.observer(node),
        })
      : await this.dependencies.execution.open(
          input,
          node.control.signal,
          this.observer(node),
        );
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

  private async sessionInput(
    node: NodeRun,
    prepared: PreparedPlanStep,
    terms: {
      readonly contract: AgentPlanContract;
      readonly mcp: AgentPlanSessionInput["mcp"];
      readonly instanceId: string;
    },
  ): Promise<AgentPlanSessionInput> {
    const directory = prepared.input.directory;
    if (directory === null) throw new AgentError("plan_directory_required");
    const scope = node.step.groupId
      ? "This is a new step in a sequential group. Only the instruction in this turn is active for this step. Earlier step instructions are completed historical context, not continuing tasks. Retain facts from that context.\n\n"
      : "";
    const prompt = `${scope}${prepared.input.prompt}\n\n${renderPlanAssignment({
      contract: terms.contract,
      usesMcp: terms.mcp !== null,
      isReadOnly:
        planSessionReach(
          prepared.input.agent.connection.provider,
          prepared.options,
        ) === "read",
      runnerLabel: node.record ? runnerLabel(node.record) : "",
      instanceId: terms.instanceId,
      directory,
      requiresAcceptance: requiresAcceptance(node.step),
      acceptanceScope: node.step.groupId ? "group" : "node",
    })}`;
    await this.pin(node, prompt);
    return {
      ...prepared.input,
      prompt,
      directory,
      options: prepared.options,
      instanceId: terms.instanceId,
      mcp: terms.mcp,
      resourceContext: { runId: node.run.id, stepId: node.step.step.id },
      journal: this.dependencies.sessions?.listen(node, terms.instanceId),
    };
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

  /** Records whether a group member opens its group's shared session or continues it. */
  private groupLink(
    node: NodeRun,
    prepared: PreparedPlanStep,
    groupKey: string,
  ): Pick<AgentPlanSessionRecord, "group"> {
    const { groupId } = node.step;
    const provider = prepared.input.agent.connection.provider;
    if (!groupId || !isAcpProvider(provider)) return {};
    return {
      group: this.groups.link(groupKey, {
        groupId,
        stepId: node.step.step.id,
        adapter: provider,
      }),
    };
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
      exit: closed.exit,
      endedAt: closed.endedAt,
      closeout: closed.isConfirmed ? "confirmed" : "failed",
      leftoverProcesses: closed.leftovers,
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
    const group = node.snapshot.groups?.find(
      (entry) => entry.id === node.step.groupId,
    );
    if (!group) return false;
    // The internal edges decide which member ends the group and its shared session.
    const last = (planGroupOrder(group) ?? group.steps).at(-1);
    if (
      last?.id === node.step.step.id ||
      turnFailureCode(turn) !== null ||
      node.control.signal.aborted
    )
      return false;
    const key = `${node.run.id}/${group.id}`;
    const nodes = this.retained.get(key) ?? [];
    nodes.push(node);
    this.retained.set(key, nodes);
    return true;
  }

  private async closeSession(
    node: NodeRun,
    session: PlanSession,
  ): Promise<PlanSessionClosed> {
    const key = `${node.run.id}/${node.step.groupId ?? node.step.step.id}`;
    const closed = await session.close();
    await this.dependencies.sessions?.released(node.record);
    this.groupInputs.delete(key);
    for (const previous of this.retained.get(key) ?? [])
      await this.complete(previous, {
        exit: closed.exit,
        endedAt: closed.endedAt,
        closeout: closed.isConfirmed ? "confirmed" : "failed",
        leftoverProcesses: closed.leftovers,
        resultCode: closeoutFailureCode(closed) === null ? 0 : -1,
      });
    this.retained.delete(key);
    await this.dependencies.access.revoke(
      node.run.id,
      node.step.groupId ?? node.step.step.id,
    );
    return closed;
  }

  private observer(node: NodeRun): PlanSessionObserver {
    return {
      capabilities: (continuationCapabilities) => {
        void this.complete(node, { continuationCapabilities });
      },
      retired: (closed, reason) => {
        void this.complete(node, {
          closeout: closed.isConfirmed ? "confirmed" : "failed",
          endedAt: closed.endedAt,
          exit: closed.exit,
          leftoverProcesses: closed.leftovers,
          resultCode: closeoutFailureCode(closed) === null ? 0 : -1,
          events: [
            ...(node.record?.events ?? []),
            `resource session retired: ${reason}`,
          ],
        });
      },
      started: (details) => {
        node.hasStarted = true;
        if (!node.record) return;
        void this.complete(node, {
          mode: details.mode,
          processId: details.processId,
          startedAt: details.startedAt,
          requested: {
            ...node.record.requested,
            unattended: details.unattended,
          },
          effective: { arguments: details.arguments.join(" ").slice(0, 2_000) },
        });
      },
      identified: (sessionId) => {
        const group = node.record?.group;
        void this.complete(node, {
          sessionId,
          ...(group ? { group: { ...group, acpSessionId: sessionId } } : {}),
        });
      },
      progressed: (events) => {
        void this.complete(node, {
          events: events.map((line) => sanitizePlanOutput(line)),
        });
      },
    };
  }

  private async failure(
    node: NodeRun,
    error: unknown,
  ): Promise<Partial<AgentPlanStepResult>> {
    if (node.step.groupId)
      await this.closeGroups(node.run.id, node.step.groupId);
    await this.dependencies.access.revoke(
      node.run.id,
      node.step.groupId ?? node.step.step.id,
    );
    await this.dependencies.sessions?.abandon(
      node.record,
      error instanceof AgentPlanCancelledError ? "cancelled" : "failed",
    );
    if (node.record)
      await this.complete(node, {
        endedAt: new Date().toISOString(),
        closeout: failureCloseout(node, error),
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
    return { status: "failed", error: errorCode(error), session: node.record };
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
    node.record = record;
    await node.control.save(record);
  }
}
