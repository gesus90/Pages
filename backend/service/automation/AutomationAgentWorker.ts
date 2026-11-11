import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { AutomationAgentJobRepository } from "@/backend/database/repositories/automation/AutomationAgentJobRepository";
import { AutomationRunRepository } from "@/backend/database/repositories/automation/AutomationRunRepository";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { AUTOMATION_ANSWER_BYTES } from "@/definition/Automation";

import { firstBytes } from "./AutomationPrompts";

import type { Database } from "@/backend/database/Database";
import type { StoredAutomationAgentJob } from "@/backend/database/repositories/automation/AutomationAgentJobRepository";
import type { AutomationAccess } from "./AutomationAccess";

/** How often the worker looks into the queues. */
const TICK_MILLISECONDS = 2000;
/** How long a busy agent is left alone before its queue is tried again. */
const BUSY_RETRY_MILLISECONDS = 10_000;

/** A started turn of an agent and the answer it will give. */
export interface AutomationAgentTurn {
  readonly sessionId: string;
  /** The final answer of the turn; rejects when the turn fails. */
  readonly answer: Promise<string>;
}

/** The agent is working on something else; the delivery waits in its queue. */
export class AutomationAgentBusyError extends Error {
  public constructor() {
    super("The agent is busy.");
    this.name = "AutomationAgentBusyError";
  }
}

/**
 * Starts a turn of an agent in its own automation session.
 *
 * @remarks
 * The turn runs as the agent's own account with its own rights; the creator
 * of the automation only names the person it works for. Exchangeable, so a
 * busy agent and a turn can be imitated without a model provider.
 */
export interface AutomationAgentRunner {
  start(request: {
    readonly agentId: string;
    readonly creatorId: string;
    /** The session key: one session per automation and purpose. */
    readonly sessionKey: string;
    readonly prompt: string;
  }): Promise<AutomationAgentTurn>;
}

/** What the worker is built from. */
export interface AutomationAgentWorkerDependencies {
  readonly database: Pick<Database, "query" | "execute">;
  readonly rules: AutomationAccess;
  readonly runner: AutomationAgentRunner;
  readonly now: () => Date;
  readonly tickMilliseconds?: number;
}

const COMPONENT = "AutomationAgentWorker";

function errorCodeOf(error: unknown): string {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
  )
    return error.code.slice(0, 80);
  return "agent_failed";
}

function sessionKeyOf(job: StoredAutomationAgentJob): string {
  const owner = job.automationId ?? job.id;
  return job.kind === "notification"
    ? `automation-notice:${owner}`
    : `automation:${owner}`;
}

/**
 * Delivers the queued work of automations to agents (PAGE-297).
 *
 * @remarks
 * It runs in the process that serves the agents' sessions. Each agent works
 * on one delivery at a time, in the order they arrived; while the agent is
 * busy with a chat or another turn, its delivery waits. Before each
 * delivery the creator's right to use the agent is checked again. A
 * delivery is `delivered` once the agent's turn started and `completed`
 * only with its stored answer; a turn that a restart interrupted fails and
 * is never repeated.
 */
export class AutomationAgentWorker {
  private readonly dependencies: AutomationAgentWorkerDependencies;
  private readonly working = new Set<string>();
  private readonly resting = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private pending: Promise<void> | null = null;

  public constructor(dependencies: AutomationAgentWorkerDependencies) {
    this.dependencies = dependencies;
  }

  /** Fails the turns an earlier process left behind and starts the passes. */
  public async start(): Promise<void> {
    if (this.timer) return;
    const jobs = new AutomationAgentJobRepository(this.dependencies.database);
    for (const job of await jobs.interrupted())
      await jobs.finish(job.id, {
        state: "failed",
        answer: null,
        errorCode: "interrupted",
        completedAt: this.dependencies.now().toISOString(),
      });
    this.timer = setInterval(
      () => this.wake(),
      this.dependencies.tickMilliseconds ?? TICK_MILLISECONDS,
    );
    this.timer.unref();
    this.wake();
  }

  /** Stops the passes; turns already started end on their own. */
  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Looks into the queues now. */
  public wake(): void {
    if (this.pending) return;
    this.pending = withBackgroundDatabaseWork("automation_agent_worker", () =>
      this.pass(),
    )
      .catch((error: unknown) => {
        logCaughtError(COMPONENT, error);
      })
      .finally(() => {
        this.pending = null;
      });
  }

  /** Starts the first waiting delivery of every agent that is free. */
  public async pass(): Promise<void> {
    const jobs = new AutomationAgentJobRepository(this.dependencies.database);
    const now = this.dependencies.now().getTime();
    for (const job of await jobs.heads()) {
      if (this.working.has(job.agentId)) continue;
      if ((this.resting.get(job.agentId) ?? 0) > now) continue;
      this.working.add(job.agentId);
      void this.deliver(job)
        .catch((error: unknown) => {
          logCaughtError(COMPONENT, error);
        })
        .finally(() => {
          this.working.delete(job.agentId);
        });
    }
  }

  private async deliver(job: StoredAutomationAgentJob): Promise<void> {
    const { database, rules, runner, now } = this.dependencies;
    const jobs = new AutomationAgentJobRepository(database);
    const creator = await rules.account(job.creatorId);
    if (!creator || !(await rules.canUseAgent(job.agentId, creator))) {
      await this.fail(job, "forbidden");
      return;
    }
    let turn: AutomationAgentTurn;
    try {
      turn = await runner.start({
        agentId: job.agentId,
        creatorId: job.creatorId,
        sessionKey: sessionKeyOf(job),
        prompt: job.prompt,
      });
    } catch (error: unknown) {
      if (error instanceof AutomationAgentBusyError) {
        this.resting.set(
          job.agentId,
          now().getTime() + BUSY_RETRY_MILLISECONDS,
        );
        return;
      }
      logCaughtError(COMPONENT, error);
      await this.fail(job, errorCodeOf(error));
      return;
    }
    this.resting.delete(job.agentId);
    if (!(await jobs.deliver(job.id, turn.sessionId, now().toISOString())))
      return;
    if (job.kind === "action" && job.runId)
      await new AutomationRunRepository(database).deliver(job.runId, null);
    logEvent({
      level: "info",
      event: "automation.agent.delivered",
      component: COMPONENT,
      message: "Automation delivered to an agent",
      metadata: { agentId: job.agentId, runId: job.runId, kind: job.kind },
    });
    try {
      const answer = await turn.answer;
      await jobs.finish(job.id, {
        state: "completed",
        answer: firstBytes(answer, AUTOMATION_ANSWER_BYTES),
        errorCode: null,
        completedAt: now().toISOString(),
      });
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
      await this.fail(job, errorCodeOf(error));
    }
  }

  private async fail(
    job: StoredAutomationAgentJob,
    errorCode: string,
  ): Promise<void> {
    await new AutomationAgentJobRepository(this.dependencies.database).finish(
      job.id,
      {
        state: "failed",
        answer: null,
        errorCode,
        completedAt: this.dependencies.now().toISOString(),
      },
    );
  }
}
