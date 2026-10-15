import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import { areTaggedProcessesGone } from "@/backend/agents/cli/CliNotesProcessScan";

import { hasSettledNotesProcesses } from "./AgentRunNotes";
import { isMissingPath } from "./AgentCanonicalPath";
import {
  requirePrivateNotesDirectory,
  requireRunNotesId,
  requireNotesRoot,
} from "./AgentRunNotesPath";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentRunNotes } from "./AgentRunNotes";

const ORPHAN_AGE_MS = 7 * 24 * 60 * 60_000;
const CLEANUP_INTERVAL_MS = 60 * 60_000;
const MAXIMUM_PLANS = 100;
const MAXIMUM_RUNS = 100;

interface CleanupDependencies {
  readonly root: string;
  readonly notes: Pick<AgentRunNotes, "discard" | "isPaused">;
  readonly runs: Pick<AgentPlanRunRepository, "find">;
  readonly processesGone?: (tags: readonly string[]) => Promise<boolean>;
}

/** Bounded hourly cleanup of known terminal runs; unknown records and process states are retained. */
export class AgentRunNotesCleanup {
  private readonly dependencies: CleanupDependencies;
  private timer: NodeJS.Timeout | null = null;
  private pending: Promise<void> | null = null;
  private planOffset = 0;
  private readonly runOffsets = new Map<string, number>();

  public constructor(dependencies: CleanupDependencies) {
    this.dependencies = dependencies;
  }

  /** Schedules limited work, without following symlinks or calling a provider. */
  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  /** Stops the worker and drains filesystem work before the database closes. */
  public async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.pending;
  }

  /** Performs one sweep; a failed or uncertain read never authorizes deletion. */
  public async runOnce(): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = this.sweep().catch((error: unknown) => {
      if (!isMissingPath(error))
        console.error("Pages run notes cleanup failed.", error);
    });
    try {
      await this.pending;
    } finally {
      this.pending = null;
    }
  }

  private async sweep(): Promise<void> {
    const { root } = this.dependencies;
    await requireNotesRoot(root);
    const plans = await this.directories(root);
    const selected = this.batch(plans, this.planOffset, MAXIMUM_PLANS);
    this.planOffset =
      (this.planOffset + selected.length) % Math.max(1, plans.length);
    for (const planId of selected) {
      try {
        await this.cleanPlan(planId);
      } catch (error: unknown) {
        console.error(
          "Pages could not inspect a run notes plan directory.",
          error,
        );
      }
    }
  }

  private async cleanPlan(planId: string): Promise<void> {
    const parent = path.join(this.dependencies.root, planId);
    await requirePrivateNotesDirectory(parent);
    const runs = await this.directories(parent);
    const offset = this.runOffsets.get(planId) ?? 0;
    const selected = this.batch(runs, offset, MAXIMUM_RUNS);
    this.runOffsets.set(
      planId,
      (offset + selected.length) % Math.max(1, runs.length),
    );
    for (const runId of selected) {
      try {
        await this.cleanRun(planId, runId);
      } catch (error: unknown) {
        console.error(
          "Pages could not clean an orphaned run notes directory.",
          error,
        );
      }
    }
  }

  private async cleanRun(planId: string, runId: string): Promise<void> {
    const { root, runs, notes } = this.dependencies;
    const directory = path.join(root, planId, runId);
    await requirePrivateNotesDirectory(directory);
    if (await notes.isPaused(directory)) return;
    const metadata = await lstat(directory);
    const run = await runs.find(runId);
    if (!run || run.planId !== planId || !hasSettledNotesProcesses(run)) return;
    const lastUse = Math.max(
      metadata.mtimeMs,
      Date.parse(run.startedAt),
      ...run.steps.map((step) =>
        step.session?.endedAt ? Date.parse(step.session.endedAt) : 0,
      ),
    );
    if (!Number.isFinite(lastUse) || Date.now() - lastUse < ORPHAN_AGE_MS)
      return;
    if (!(await this.processesGone(run))) return;
    // Re-read after process inspection, preserving a concurrently changed or uncertain run.
    const current = await runs.find(runId);
    if (!current || JSON.stringify(current) !== JSON.stringify(run)) return;
    await notes.discard({
      root: await realpath(root),
      directory: await realpath(directory),
    });
  }

  private async processesGone(run: AgentPlanRun): Promise<boolean> {
    const tags = run.steps.flatMap((step) =>
      step.session ? [step.session.instanceId] : [],
    );
    return (this.dependencies.processesGone ?? areTaggedProcessesGone)(tags);
  }

  private async directories(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .filter((name) => {
        try {
          requireRunNotesId(name);
          return true;
        } catch {
          return false;
        }
      })
      .sort();
  }

  private batch(
    entries: readonly string[],
    offset: number,
    maximum: number,
  ): readonly string[] {
    return [...entries.slice(offset), ...entries.slice(0, offset)].slice(
      0,
      maximum,
    );
  }
}
