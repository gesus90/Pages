import { randomUUID } from "node:crypto";

import { AutomationAgentJobRepository } from "@/backend/database/repositories/automation/AutomationAgentJobRepository";
import { AutomationRepository } from "@/backend/database/repositories/automation/AutomationRepository";
import { AutomationRunRepository } from "@/backend/database/repositories/automation/AutomationRunRepository";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  AUTOMATION_ANSWER_BYTES,
  AUTOMATION_FORWARD_OUTPUT_BYTES,
} from "@/definition/Automation";

import {
  actionPrompt,
  firstBytes,
  forwardPrompt,
  lastBytes,
} from "./AutomationPrompts";

import type { Database } from "@/backend/database/Database";
import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type { StoredAutomationRun } from "@/backend/database/repositories/automation/AutomationRunRepository";
import type { AutomationScriptAction } from "@/definition/Automation";
import type { AutomationAccess } from "./AutomationAccess";
import type { AutomationAccount } from "./AutomationDirectory";
import type {
  AutomationRunConclusion,
  AutomationRunEnding,
} from "./AutomationRunEnding";
import type { AutomationScriptResult } from "./AutomationScriptProcess";

/** Plan run states that have not ended. */
const ACTIVE_PLAN_STATES: ReadonlySet<string> = new Set([
  "running",
  "pausing",
  "paused",
  "stopping",
]);
const SUMMARY_CHARACTERS = 200;

/** What a run reaches outside the automations; exchangeable for tests and simulations. */
export interface AutomationExecutionPorts {
  /** Starts a new run of a plan as the account and returns its ID. */
  readonly startPlan: (userId: string, planId: string) => Promise<string>;
  /** The status of a plan run of the account; `null` when it is gone. */
  readonly planRunStatus: (
    userId: string,
    runId: string,
  ) => Promise<string | null>;
  /** Runs an authorized script in the account's workspace. */
  readonly runScript: (request: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly interpreterProfileId: string;
    readonly content: string;
    readonly input: string;
    readonly timeoutSeconds: number;
    readonly signal: AbortSignal;
  }) => Promise<AutomationScriptResult>;
}

/** What the executor is built from. */
export interface AutomationRunExecutorDependencies {
  readonly database: Pick<Database, "query" | "execute" | "transaction">;
  readonly rules: AutomationAccess;
  readonly ending: AutomationRunEnding;
  readonly ports: AutomationExecutionPorts;
  readonly now: () => Date;
}

function summaryOf(text: string | null | undefined): string | null {
  const line = text
    ?.split("\n")
    .find((entry) => entry.trim() !== "")
    ?.trim();
  if (!line) return null;
  const characters = Array.from(line);
  return characters.length > SUMMARY_CHARACTERS
    ? `${characters.slice(0, SUMMARY_CHARACTERS - 1).join("")}…`
    : line;
}

function errorCodeOf(error: unknown): string {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
  )
    return error.code.slice(0, 80);
  return "failed";
}

function scriptOutput(result: AutomationScriptResult): string {
  const stdout = result.stdout ?? "";
  const stderr =
    result.stderr.trim() === "" ? "" : `\n[stderr]\n${result.stderr}`;
  return `${stdout}${stderr}`;
}

function shouldForward(
  action: AutomationScriptAction,
  exitCode: number | null,
): boolean {
  if (!action.forward) return false;
  if (action.forward.when === "always") return true;
  return action.forward.when === "zero" ? exitCode === 0 : exitCode !== 0;
}

/**
 * Starts claimed runs and settles runs whose work happens elsewhere (PAGE-297).
 *
 * @remarks
 * Before every start the creator's rights are checked again; without them
 * nothing runs and the run ends as forbidden. A script runs here and its run
 * ends with the script itself. An agent action waits in the agent's queue;
 * the web process delivers it and this executor settles the run from the
 * stored answer. A plan action starts a normal run of the plan and settles
 * when that run ended.
 */
export class AutomationRunExecutor {
  private readonly dependencies: AutomationRunExecutorDependencies;
  private readonly scripts = new Map<string, AbortController>();
  /** Runs whose start is still in progress in this process. */
  private readonly starting = new Set<string>();

  public constructor(dependencies: AutomationRunExecutorDependencies) {
    this.dependencies = dependencies;
  }

  /** Whether this process runs the work of a run itself. */
  public isExecuting(runId: string): boolean {
    return this.starting.has(runId) || this.scripts.has(runId);
  }

  /** Stops the scripts of this process; their runs end as cancelled. */
  public abortAll(): void {
    for (const controller of this.scripts.values()) controller.abort();
  }

  /**
   * Starts a claimed run.
   *
   * @param run - The run, claimed by this process.
   */
  public async start(run: StoredAutomationRun): Promise<void> {
    this.starting.add(run.id);
    try {
      const automation = await new AutomationRepository(
        this.dependencies.database,
      ).find(run.automationId);
      if (!automation) return;
      const blocker = await this.dependencies.rules.runBlocker(automation);
      if (blocker) {
        await this.end(run, { outcome: "forbidden", errorCode: blocker });
        return;
      }
      await this.startAction(automation, run);
    } catch (error: unknown) {
      logCaughtError("AutomationRunExecutor", error);
      await this.end(run, { outcome: "failed", errorCode: errorCodeOf(error) });
    } finally {
      this.starting.delete(run.id);
    }
  }

  /**
   * Settles a run whose work this process does not do itself.
   *
   * @param run - A run that is accepted or delivered.
   */
  public async settle(run: StoredAutomationRun): Promise<void> {
    if (this.isExecuting(run.id)) return;
    const { database } = this.dependencies;
    if (run.planRunId) {
      await this.settlePlan(run);
      return;
    }
    const jobs = await new AutomationAgentJobRepository(database).forRuns([
      run.id,
    ]);
    const job = jobs.find((entry) => entry.kind === "action");
    if (!job) {
      // The work belonged to a process that ended before it was handed on.
      await this.end(run, { outcome: "failed", errorCode: "interrupted" });
      return;
    }
    if (job.state === "completed") {
      const answer = firstBytes(job.answer ?? "", AUTOMATION_ANSWER_BYTES);
      await this.end(run, {
        outcome: "ok",
        answer,
        summary: summaryOf(answer),
      });
    } else if (job.state === "failed")
      await this.end(run, {
        outcome: job.errorCode === "forbidden" ? "forbidden" : "failed",
        errorCode: job.errorCode,
      });
  }

  private async startAction(
    automation: StoredAutomation,
    run: StoredAutomationRun,
  ): Promise<void> {
    const { action } = automation;
    if (action.type === "agent") {
      const creator = await this.creator(automation);
      await new AutomationAgentJobRepository(
        this.dependencies.database,
      ).enqueue({
        id: randomUUID(),
        runId: run.id,
        automationId: automation.id,
        agentId: action.agentId,
        creatorId: automation.creatorId,
        kind: "action",
        prompt: actionPrompt(automation, run, creator.language),
        queuedAt: this.dependencies.now().toISOString(),
      });
      return;
    }
    if (action.type === "plan") {
      const planRunId = await this.dependencies.ports.startPlan(
        automation.creatorId,
        action.planId,
      );
      await new AutomationRunRepository(this.dependencies.database).deliver(
        run.id,
        planRunId,
      );
      return;
    }
    await this.runScript(automation, action, run);
  }

  private async runScript(
    automation: StoredAutomation,
    action: AutomationScriptAction,
    run: StoredAutomationRun,
  ): Promise<void> {
    const { database, ports } = this.dependencies;
    const controller = new AbortController();
    this.scripts.set(run.id, controller);
    try {
      await new AutomationRunRepository(database).deliver(run.id, null);
      const result = await ports.runScript({
        userId: automation.creatorId,
        workspaceId: action.workspaceId,
        interpreterProfileId: action.interpreterProfileId,
        content: action.content ?? "",
        input: this.scriptInput(automation, run),
        timeoutSeconds: action.timeoutSeconds,
        signal: controller.signal,
      });
      const output = scriptOutput(result);
      const forwardState = await this.forward(automation, action, run, {
        exitCode: result.exitCode,
        output,
      });
      const isSuccess = result.failure === null && result.exitCode === 0;
      await this.end(run, {
        outcome: isSuccess ? "ok" : "failed",
        exitCode: result.exitCode,
        forwardState,
        errorCode: isSuccess ? null : (result.failure ?? "exit"),
        summary: summaryOf(result.stdout) ?? summaryOf(result.stderr),
        output: lastBytes(output, AUTOMATION_FORWARD_OUTPUT_BYTES),
        error:
          result.stderr.trim() === "" ? null : lastBytes(result.stderr, 2000),
      });
    } finally {
      this.scripts.delete(run.id);
    }
  }

  /** Wakes the forward agent when the condition holds and the creator may still use it. */
  private async forward(
    automation: StoredAutomation,
    action: AutomationScriptAction,
    run: StoredAutomationRun,
    result: { readonly exitCode: number | null; readonly output: string },
  ): Promise<"woken" | "not_woken" | null> {
    if (!action.forward) return null;
    if (!shouldForward(action, result.exitCode)) return "not_woken";
    const creator = await this.creator(automation);
    if (
      !(await this.dependencies.rules.canUseAgent(
        action.forward.agentId,
        creator,
      ))
    )
      return "not_woken";
    await new AutomationAgentJobRepository(this.dependencies.database).enqueue({
      id: randomUUID(),
      runId: run.id,
      automationId: automation.id,
      agentId: action.forward.agentId,
      creatorId: automation.creatorId,
      kind: "forward",
      prompt: forwardPrompt(automation, run, result, creator.language),
      queuedAt: this.dependencies.now().toISOString(),
    });
    return "woken";
  }

  private scriptInput(
    automation: StoredAutomation,
    run: StoredAutomationRun,
  ): string {
    let triggerData: unknown = null;
    try {
      triggerData = run.triggerData ? JSON.parse(run.triggerData) : null;
    } catch {
      triggerData = null;
    }
    return `${JSON.stringify({
      automation: { id: automation.id, name: automation.name },
      runId: run.id,
      trigger: run.triggerKind,
      eventType: run.eventType,
      at: run.queuedAt,
      data: triggerData,
    })}\n`;
  }

  private async settlePlan(run: StoredAutomationRun): Promise<void> {
    const automation = await new AutomationRepository(
      this.dependencies.database,
    ).find(run.automationId);
    if (!automation || !run.planRunId) return;
    const status = await this.dependencies.ports.planRunStatus(
      automation.creatorId,
      run.planRunId,
    );
    if (status !== null && ACTIVE_PLAN_STATES.has(status)) return;
    await this.end(run, {
      outcome: status === "succeeded" ? "ok" : "failed",
      planRunStatus: status,
      errorCode: status === null ? "plan_run_unavailable" : null,
    });
  }

  private async creator(
    automation: StoredAutomation,
  ): Promise<AutomationAccount> {
    const creator = await this.dependencies.rules.account(automation.creatorId);
    if (!creator) throw new Error("The creator of the automation is missing.");
    return creator;
  }

  private async end(
    run: StoredAutomationRun,
    conclusion: AutomationRunConclusion,
  ): Promise<void> {
    await this.dependencies.ending.end(run, conclusion);
  }
}
