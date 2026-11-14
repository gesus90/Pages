import { logCaughtError } from "@/backend/logging/Logger";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { PendingLogbookSession } from "@/backend/database/repositories/employee/AgentLogbookSessionRepository";
import type { AgentLogbookSummarizer } from "./AgentLogbookSummarizer";

/** How often the scheduler looks for quiet chats. */
const TICK_MILLISECONDS = 30_000;
/** How long a chat whose summary got no usable answer waits before its next try. */
const RETRY_MILLISECONDS = 10 * 60_000;

/** What the scheduler runs on. */
export interface AgentLogbookSchedulerDependencies {
  readonly store: Pick<EmployeeStore, "logbookSessions">;
  readonly summarizer: Pick<AgentLogbookSummarizer, "summarize">;
  /** Whether the agent answers in a chat now; its summaries wait for it to be free. */
  readonly isWorking: (agentId: string) => boolean;
  readonly now?: () => Date;
}

/**
 * Starts the background summaries of quiet chats (PAGE-377): a chat whose
 * agent answered and then heard nothing for the quiet time set for that agent
 * (two minutes by default) is summarized once, one chat after the other.
 *
 * @remarks
 * What is due lives in the database (the last round of a session and its last
 * summary), so a restart loses nothing. A chat whose agent is answering in a
 * chat waits for the next look, so a summary never competes with a chat
 * session; one without a usable answer is tried again after ten minutes.
 */
export class AgentLogbookScheduler {
  private readonly dependencies: AgentLogbookSchedulerDependencies;
  private readonly retryAfter = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick: Promise<void> | null = null;

  public constructor(dependencies: AgentLogbookSchedulerDependencies) {
    this.dependencies = dependencies;
  }

  /** Starts looking for quiet chats; a second call changes nothing. */
  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runDue();
    }, TICK_MILLISECONDS);
    this.timer.unref();
  }

  /** Stops looking and waits for a running look to end. */
  public async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.tick;
  }

  /** Summarizes every chat that is due once; a look that is still going is not started twice. */
  public runDue(): Promise<void> {
    this.tick ??= this.runAll().finally(() => {
      this.tick = null;
    });
    return this.tick;
  }

  private async runAll(): Promise<void> {
    try {
      const pending = await this.dependencies.store.logbookSessions().pending();
      for (const session of pending)
        if (this.isDue(session)) await this.summarize(session);
    } catch (error: unknown) {
      logCaughtError("AgentLogbookScheduler", error);
    }
  }

  private isDue(session: PendingLogbookSession): boolean {
    const now = this.now();
    const quietSince = new Date(session.lastActivityAt).getTime();
    if (Number.isNaN(quietSince)) return false;
    if (now - quietSince < session.quietMinutes * 60_000) return false;
    if ((this.retryAfter.get(session.sessionId) ?? 0) > now) return false;
    return !this.dependencies.isWorking(session.agentId);
  }

  private async summarize(session: PendingLogbookSession): Promise<void> {
    try {
      const outcome = await this.dependencies.summarizer.summarize(session);
      if (outcome.status === "retry")
        this.retryAfter.set(session.sessionId, this.now() + RETRY_MILLISECONDS);
      else this.retryAfter.delete(session.sessionId);
    } catch (error: unknown) {
      logCaughtError("AgentLogbookScheduler", error);
      this.retryAfter.set(session.sessionId, this.now() + RETRY_MILLISECONDS);
    }
  }

  private now(): number {
    return (this.dependencies.now?.() ?? new Date()).getTime();
  }
}
