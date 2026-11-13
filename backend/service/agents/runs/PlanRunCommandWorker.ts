import { setTimeout as wait } from "node:timers/promises";

import {
  pagesRunsOwnershipSchema,
  pagesRunsSwarmSchema,
} from "@/definition/PagesRuns";
import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { PlanRunCommandRepository } from "@/backend/database/repositories/agent/PlanRunCommandRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AgentError, isAgentErrorCode } from "@/backend/error/AgentErrors";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import {
  logCaughtError,
  logEvent,
  withLogContext,
} from "@/backend/logging/Logger";
import { recordServiceProgress } from "@/backend/runtime/ServiceWorkHealth";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";

import { RunsSocket } from "./RunsSocket";
import { answerSwarmCall } from "../swarm/SwarmRegistry";
import { endedPlanRun } from "../AgentPlanRunState";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { PendingPlanRunCommand } from "@/backend/database/repositories/agent/PlanRunCommandRepository";
import type { Database } from "@/backend/database/Database";
import type { AgentPlanRunEngine } from "../AgentPlanRunEngine";
import type { AgentPlanRemoteExecution } from "../AgentPlanRemoteExecution";
import type { AgentPlanRunJournal } from "../AgentPlanJournal";
import type { AgentPlanSnapshot } from "../AgentPlanSnapshot";

/** Single-owner scheduler inbox; polling survives lost notifications and peer restarts. */
export class PlanRunCommandWorker {
  private readonly database: Database;
  private readonly commands: PlanRunCommandRepository;
  private readonly runs: AgentPlanRunRepository;
  private readonly engine: AgentPlanRunEngine;
  private readonly remote: AgentPlanRemoteExecution;
  private readonly socket: RunsSocket;
  private timer: NodeJS.Timeout | null = null;
  private pending: Promise<void> | null = null;
  private isClosing = false;

  public constructor(
    database: Database,
    engine: AgentPlanRunEngine,
    remote: AgentPlanRemoteExecution,
    socketPath: string,
  ) {
    this.database = database;
    this.commands = new PlanRunCommandRepository(database);
    this.runs = new AgentPlanRunRepository(database);
    this.engine = engine;
    this.remote = remote;
    this.socket = new RunsSocket(
      socketPath,
      () => this.wake(),
      (input) => {
        const swarm = pagesRunsSwarmSchema.safeParse(input);
        if (swarm.success) return Promise.resolve(answerSwarmCall(swarm.data));
        const request = pagesRunsOwnershipSchema.parse(input);
        return Promise.resolve({ active: this.engine.isActive(request.runId) });
      },
      "/v1/engine",
    );
  }

  /** Starts only after startup recovery restored the engine's active map. */
  public async start(): Promise<void> {
    do {
      await this.consume();
      if (!(await this.commands.hasAccepted())) break;
      await wait(100);
    } while (!this.isClosing);
    await this.socket.listen();
    this.engine.activateScheduling();
    this.timer = setInterval(() => this.wake(), 500);
    this.wake();
  }

  /** Stops admission and drains the current command before engine shutdown. */
  public async stop(): Promise<void> {
    this.isClosing = true;
    if (this.timer) clearInterval(this.timer);
    await this.socket.close();
    await this.pending;
  }

  private wake(): void {
    if (this.isClosing || this.pending) return;
    this.pending = withBackgroundDatabaseWork("plan_run_commands", () =>
      this.consume(),
    )
      .then(() => {
        if (!this.isClosing) this.engine.activateScheduling();
      })
      .catch((error: unknown) => logCaughtError("PlanRunCommandWorker", error))
      .finally(() => {
        this.pending = null;
      });
  }

  private async consume(): Promise<void> {
    await this.engine.reconcileRetiredRuns();
    for (const command of await this.commands.pending()) {
      if (this.isClosing) return;
      try {
        await this.apply(command);
      } catch (error: unknown) {
        logCaughtError("PlanRunCommandWorker", error);
      }
      recordServiceProgress("runs.commands");
    }
    recordServiceProgress("runs.commands");
  }

  private async apply(command: PendingPlanRunCommand): Promise<void> {
    const { receipt } = command;
    const run = await this.runs.find(receipt.runId);
    if (!run) {
      await this.commands.failed(receipt.id, "plan_run_unavailable");
      return;
    }
    if (receipt.status === "accepted") {
      let snapshot: AgentPlanSnapshot | undefined;
      try {
        snapshot = await this.commands.readSnapshot(command.snapshotFile);
      } catch (error: unknown) {
        logCaughtError("PlanRunCommandWorker", error);
        await this.reject(command, run, "plan_run_unreadable");
        return;
      }
      try {
        await this.applyState(command, run, snapshot);
      } catch (error: unknown) {
        if (!(
          error instanceof AgentError || error instanceof AgentPlanRecoveryError
        ))
          throw error;
        const stored = await this.commands.latest(run.id);
        if (stored?.id !== receipt.id || stored.status !== "applied")
          await this.reject(command, run, error.code);
        return;
      }
    }
    const current = (await this.runs.find(run.id)) ?? run;
    // The transition already committed. Any peer failure retains this delivery for a later poll.
    if (receipt.action === "stop") await this.remote.stop(current);
    if (
      receipt.action === "pause" &&
      ["paused", "pausing"].includes(current.status)
    )
      await this.remote.pause(current);
    await this.commands.delivered(receipt.id);
  }

  private async reject(
    command: PendingPlanRunCommand,
    run: AgentPlanRun,
    code: string,
  ): Promise<void> {
    if (command.receipt.action !== "start" || !isActivePlanRun(run.status)) {
      await this.commands.failed(command.receipt.id, code);
      return;
    }
    // An adopted owner must settle its own processes; only an unstarted run can close here.
    if (
      this.engine.isActive(run.id) ||
      allPlanRunResults(run).some((step) => step.status === "running")
    )
      throw new Error("Cannot reject a start while execution is owned.");
    const failed: AgentPlanRun = {
      ...endedPlanRun(run, "failed"),
      startError: code,
      steps: run.steps.map((step) =>
        step.status === "waiting" || step.status === "paused"
          ? {
              ...step,
              status: "cancelled",
              cancellation: "not_started",
              isBlocked: false,
            }
          : step,
      ),
      ...(run.loops
        ? {
            loops: run.loops.map((loop) =>
              loop.status === "waiting" || loop.status === "paused"
                ? { ...loop, status: "cancelled", error: code }
                : loop,
            ),
          }
        : {}),
    };
    await this.runs.update(failed, undefined, undefined, (transaction) =>
      this.commands.failed(command.receipt.id, code, transaction),
    );
    const reason = isAgentErrorCode(code) ? new AgentError(code).message : code;
    withLogContext({ runId: run.id }, () =>
      logEvent({
        level: "error",
        event: "agent.run.completed",
        component: "PlanRunCommandWorker",
        message: `Agent plan start failed: ${reason} (${code})`,
        metadata: { status: "failed", code },
      }),
    );
  }

  private async applyState(
    command: PendingPlanRunCommand,
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot | undefined,
  ): Promise<void> {
    const { receipt } = command;
    const journal: AgentPlanRunJournal = (transaction) =>
      this.commands.applied(transaction, receipt.id);
    if (receipt.action === "start") {
      if (
        isActivePlanRun(run.status) &&
        !this.engine.isActive(run.id) &&
        !(await this.engine.adopt(run))
      )
        throw new AgentError("plan_run_unavailable");
      await this.database.transaction((transaction) =>
        journal(transaction, run),
      );
    } else if (receipt.action === "stop") {
      await this.engine.stop(run.id, journal);
    } else if (receipt.action === "pause") {
      await this.engine.pause(run.id, journal);
    } else {
      await this.engine.resume(run.id, snapshot, journal);
    }
  }
}
