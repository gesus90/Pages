import { randomUUID } from "node:crypto";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { isApiProvider } from "@/definition/AgentConnection";

import { evaluatePlanAcceptance } from "./AgentPlanAcceptance";
import { buildPlanContract, renderPlanAssignment } from "./AgentPlanContract";
import { sanitizePlanOutput } from "./AgentPlanOutput";
import {
  createSessionRecord,
  failureCode,
  runnerLabel,
  withTurn,
} from "./AgentPlanSessionRecords";

import type {
  PlanExecution,
  PlanSession,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentPlanContract,
  AgentPlanSessionRecord,
} from "@/definition/AgentPlanSession";
import type { AgentPlanTicketStates } from "./AgentPlanAcceptance";
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
import type { AgentRunArchive } from "./AgentRunArchive";

interface StepRunnerDependencies {
  readonly start: Pick<AgentPlanStepStart, "prepare">;
  readonly execution: PlanExecution;
  readonly tasks: Pick<AgentPlanTasks, "checklist">;
  readonly access: Pick<AgentPlanSessionAccess, "grant" | "revoke">;
  readonly archive?: AgentRunArchive;
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
  readonly snapshot: AgentPlanSnapshot;
  readonly step: AgentPlanStepSnapshot;
  control: StepRunControl;
  record: AgentPlanSessionRecord | null;
  hasStarted: boolean;
}

function errorCode(error: unknown): string {
  if (error instanceof AgentError || error instanceof TextAssistantError)
    return error.code;
  return "plan_step_failed";
}

function hasTimedOut(signal: AbortSignal): boolean {
  return (
    signal.aborted &&
    signal.reason instanceof DOMException &&
    signal.reason.name === "TimeoutError"
  );
}

/**
 * Runs one agent node: request or session, acceptance, closeout and result code.
 *
 * @remarks
 * The record of the node, with the requested configuration, the todo list and
 * the acceptance criteria, is stored before any process starts, and the sent
 * prompt is pinned before it leaves. A session counts only after an accepted
 * closing report and a confirmed closeout: then the normalized result is 0,
 * in every other case -1, and the real process exit is kept apart.
 */
export class AgentPlanStepRunner {
  private readonly dependencies: StepRunnerDependencies;

  public constructor(dependencies: StepRunnerDependencies) {
    this.dependencies = dependencies;
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
    try {
      return await this.execute(node);
    } catch (error: unknown) {
      return this.failure(node, error);
    }
  }

  private async execute(node: NodeRun): Promise<Partial<AgentPlanStepResult>> {
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
    const contract = buildPlanContract(step.step.instruction, tickets);
    const instanceId = randomUUID();
    await this.save(
      node,
      createSessionRecord({
        instanceId,
        prepared,
        contract,
        usesMcp: contract.tickets.length > 0,
      }),
    );
    const mcp = await this.dependencies.access.grant({
      userId: run.userId,
      runId: run.id,
      stepId: step.step.id,
      tickets: contract.tickets,
      lifetimeMs: prepared.options.timeoutMinutes * 60_000,
    });
    const prompt = `${prepared.input.prompt}\n\n${renderPlanAssignment({
      contract,
      usesMcp: mcp !== null,
      runnerLabel: node.record ? runnerLabel(node.record) : "",
      instanceId,
      directory,
    })}`;
    await this.pin(node, prompt);
    const session = await this.dependencies.execution.open(
      {
        ...prepared.input,
        prompt,
        directory,
        options: prepared.options,
        instanceId,
        mcp,
      },
      node.control.signal,
      this.observer(node),
    );
    node.hasStarted = true;
    try {
      return await this.finish(node, session, contract);
    } catch (error: unknown) {
      // A started session is always ended, also when its evaluation failed.
      await session.close().catch((closeError: unknown) => {
        console.error("Pages could not close an agent session.", closeError);
      });
      throw error;
    }
  }

  private async finish(
    node: NodeRun,
    session: PlanSession,
    contract: AgentPlanContract,
  ): Promise<Partial<AgentPlanStepResult>> {
    const turn = await session.turn;
    if (node.record) node.record = withTurn(node.record, turn);
    const acceptance =
      turn.failure === null
        ? evaluatePlanAcceptance(
            contract,
            turn.output,
            await this.ticketStates(node, contract),
          )
        : null;
    // The closing report and the verdict are kept before the session is ended.
    await this.complete(node, { acceptance });
    const closed = await session.close();
    await this.dependencies.access.revoke(node.run.id, node.step.step.id);
    const failure = hasTimedOut(node.control.signal)
      ? "timeout"
      : failureCode(turn, acceptance, closed);
    await this.complete(node, {
      exit: closed.exit,
      endedAt: closed.endedAt,
      closeout: closed.isConfirmed ? "confirmed" : "failed",
      leftoverProcesses: closed.leftovers,
      resultCode: failure === null ? 0 : -1,
    });
    const output = turn.output ? sanitizePlanOutput(turn.output) : null;
    if (turn.failure === "cancelled")
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

  private async ticketStates(
    node: NodeRun,
    contract: AgentPlanContract,
  ): Promise<AgentPlanTicketStates> {
    const checked = new Map<string, boolean>();
    const unreadable: string[] = [];
    const changed: string[] = [];
    for (const ticket of contract.tickets) {
      try {
        const current = await this.dependencies.tasks.checklist(
          node.run.userId,
          node.snapshot.plan.projectId,
          ticket.id,
        );
        if (
          ticket.requirementsHash !== undefined &&
          current.checklist.requirementsHash !== ticket.requirementsHash
        )
          changed.push(ticket.key);
        for (const item of current.checklist.items)
          checked.set(`${ticket.id}\n${item.id}`, item.checked);
      } catch {
        unreadable.push(ticket.key);
      }
    }
    return { checked, unreadable, changed };
  }

  private observer(node: NodeRun): PlanSessionObserver {
    return {
      started: (details) => {
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
        void this.complete(node, { sessionId });
      },
    };
  }

  private async failure(
    node: NodeRun,
    error: unknown,
  ): Promise<Partial<AgentPlanStepResult>> {
    await this.dependencies.access.revoke(node.run.id, node.step.step.id);
    if (node.record)
      await this.complete(node, {
        endedAt: new Date().toISOString(),
        closeout:
          node.record.closeout === "pending"
            ? "not_needed"
            : node.record.closeout,
        resultCode: -1,
      });
    if (hasTimedOut(node.control.signal))
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
    await this.dependencies.archive?.input(
      node.run.id,
      node.step.step.id,
      prompt,
    );
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
