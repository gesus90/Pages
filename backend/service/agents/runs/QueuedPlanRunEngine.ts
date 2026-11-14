import { setTimeout as wait } from "node:timers/promises";

import { AgentError } from "@/backend/error/AgentErrors";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AgentPlanStartResourceRepository } from "@/backend/database/repositories/agent/AgentPlanStartResourceRepository";
import { logCaughtError } from "@/backend/logging/Logger";
import { PlanRunCommandRepository } from "@/backend/database/repositories/agent/PlanRunCommandRepository";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import { capturePlanExecution } from "../AgentPlanExecutionSnapshot";
import { initialPlanRun, recoveredPlanRun } from "../AgentPlanRunStart";
import { planWritingWorkspaces } from "../AgentPlanContinuation";
import { AgentPlanStartResources } from "../AgentPlanStartResources";
import {
  notifyRuns,
  queryRunOwnership,
  releaseRunsStartResources,
} from "./RunsSocket";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type {
  PlanRunCommandAction,
  PlanRunCommandReceipt,
} from "@/definition/PagesRuns";
import type { AgentPlanRunRecording } from "../AgentPlanRunRecording";
import type { AgentPlanRunJournal } from "../AgentPlanJournal";
import type { AgentPlanSnapshot } from "../AgentPlanSnapshot";
import type { RecoveredRunStart } from "../AgentPlanRunStart";
import type { PlanRunEnginePort } from "./PlanRunEnginePort";

/** API producer: commits requests without owning, recovering or terminating executions. */
export class QueuedPlanRunEngine implements PlanRunEnginePort {
  private readonly database: Database;
  private readonly runs: AgentPlanRunRepository;
  private readonly commands: PlanRunCommandRepository;
  private readonly socketPath: string;
  private readonly starts = new SerialQueue();
  private isClosing = false;

  public constructor(database: Database, socketPath: string) {
    this.database = database;
    this.runs = new AgentPlanRunRepository(database);
    this.commands = new PlanRunCommandRepository(database);
    this.socketPath = socketPath;
  }

  /** Commits the frozen run, reservation and start command together. */
  public async start(
    userId: string,
    snapshot: AgentPlanSnapshot,
    recording?: AgentPlanRunRecording,
    journal?: AgentPlanRunJournal,
  ): Promise<AgentPlanRun> {
    return this.starts.run(() =>
      this.enqueueStart(initialPlanRun(userId, snapshot), snapshot, {
        recording,
        journal,
      }),
    );
  }

  /** Preserves recovery's atomic journal and predecessor retirement at admission. */
  public async startRecovered(
    userId: string,
    snapshot: AgentPlanSnapshot,
    recovered: RecoveredRunStart,
    journal: AgentPlanRunJournal,
  ): Promise<AgentPlanRun> {
    return this.starts.run(() =>
      this.enqueueStart(
        recoveredPlanRun(userId, snapshot, recovered),
        snapshot,
        { journal },
      ),
    );
  }

  /** Acknowledges cancellation after durable admission, even while the owner is unavailable. */
  public async stop(id: string, journal?: AgentPlanRunJournal): Promise<void> {
    await this.enqueue(id, "stop", { journal });
  }

  /** Queues the scheduling pause; an acknowledgement is not a completed pause. */
  public async pause(id: string, journal?: AgentPlanRunJournal): Promise<void> {
    await this.enqueue(id, "pause", { journal });
  }

  /** Pins the already authorized continuation basis for later consumption. */
  public async resume(
    id: string,
    snapshot?: AgentPlanSnapshot,
    journal?: AgentPlanRunJournal,
  ): Promise<void> {
    await this.enqueue(id, "resume", { snapshot, journal });
  }

  /** Records the existing logical reset; the owner reconciles its durable cancellation fence. */
  public async resetLogical(
    id: string,
    record: () => Promise<AgentPlanRun>,
  ): Promise<void> {
    const retired = await record();
    if (retired.id !== id) throw new AgentError("plan_context_changed");
    void notifyRuns(this.socketPath);
  }

  /** Ownership queries never make the API an engine. Runner facts stay database-backed. */
  public async isActive(id: string): Promise<boolean> {
    try {
      return await queryRunOwnership(this.socketPath, id);
    } catch {
      return true;
    }
  }

  /** Whether admission has stopped for API shutdown. */
  public isShuttingDown(): boolean {
    return this.isClosing;
  }

  /** Recovery belongs exclusively to the elected process. */
  public async adopt(): Promise<boolean> {
    return false;
  }

  /** The producer does not discover or signal local owners. */
  public unverifiedLocalSessions(): ReadonlySet<string> {
    return new Set();
  }

  /** Project deletion is bounded and cannot erase still-active run resources. */
  public async stopProject(projectId: string): Promise<boolean> {
    const ids: string[] = [];
    for (const run of await this.runs.unfinished()) {
      if ((await this.runs.resources(run.id)).projectId !== projectId) continue;
      ids.push(run.id);
      await this.stop(run.id);
    }
    return this.waitForClose(ids);
  }

  /** API shutdown closes admission only; it never cancels runs. */
  public async shutdown(): Promise<void> {
    this.isClosing = true;
  }

  /** Returns the committed receipt for an already authorized run. */
  public commandReceipt(runId: string): Promise<PlanRunCommandReceipt | null> {
    return this.commands.latest(runId);
  }

  private async enqueueStart(
    view: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    terms: {
      readonly recording?: AgentPlanRunRecording;
      readonly journal?: AgentPlanRunJournal;
    },
  ): Promise<AgentPlanRun> {
    if (this.isClosing) throw new AgentError("plan_access_denied");
    if (view.origin?.kind !== "resume") {
      let warnings: readonly string[];
      try {
        warnings = await releaseRunsStartResources(
          this.socketPath,
          view,
          snapshot,
        );
      } catch (error: unknown) {
        logCaughtError("QueuedPlanRunEngine", error);
        const resources = new AgentPlanStartResources({
          repository: new AgentPlanStartResourceRepository(this.database),
        });
        warnings = await resources.release(
          view,
          snapshot,
          async (runId, record) => {
            await record();
          },
        );
      }
      if (warnings.length)
        view = { ...view, startCleanupUnconfirmed: warnings };
    }
    const captured = capturePlanExecution(view, snapshot);
    const receipt = this.commands.receipt(view.id, "start");
    await this.runs.prepareSnapshot(view.id, captured.snapshot);
    const create = async (transaction: DatabaseTransaction): Promise<void> => {
      await this.runs.insert(
        transaction,
        captured.run,
        captured.snapshot,
        planWritingWorkspaces(captured.snapshot),
      );
      await this.commands.insert(transaction, receipt);
      await terms.journal?.(transaction, { ...captured.run, command: receipt });
    };
    if (terms.recording) await terms.recording(create);
    else await this.database.transaction(create);
    void notifyRuns(this.socketPath);
    return { ...captured.run, command: receipt };
  }

  private async enqueue(
    id: string,
    action: PlanRunCommandAction,
    terms: {
      readonly snapshot?: AgentPlanSnapshot;
      readonly journal?: AgentPlanRunJournal;
    },
  ): Promise<void> {
    if (this.isClosing) throw new AgentError("plan_access_denied");
    const run = await this.runs.find(id);
    if (!run) throw new AgentError("plan_run_unavailable");
    const receipt = this.commands.receipt(id, action);
    const snapshotFile = await this.commands.snapshot(
      run.planId,
      terms.snapshot,
    );
    await this.database.transaction(async (transaction) => {
      await this.commands.insert(transaction, receipt, snapshotFile);
      await terms.journal?.(transaction, { ...run, command: receipt });
    });
    void notifyRuns(this.socketPath);
  }

  private async waitForClose(ids: readonly string[]): Promise<boolean> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const runs = await Promise.all(ids.map((id) => this.runs.find(id)));
      if (runs.every((run) => !run || !isActivePlanRun(run.status)))
        return true;
      await wait(100);
    }
    return false;
  }
}
