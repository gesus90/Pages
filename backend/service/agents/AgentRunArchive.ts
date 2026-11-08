import { createHash } from "node:crypto";
import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { AgentError } from "@/backend/error/AgentErrors";
import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { readArchiveSteps } from "@/backend/agents/PageAgentRecordInput";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import {
  artifactDirectory,
  artifactExists,
  requireArtifactId,
  writeArtifact,
} from "./AgentArtifactPath";
import { sanitizeArtifactText } from "./AgentPlanOutput";
import { renderAgentRunRecord } from "./AgentRunMarkdown";

import type { Dirent } from "node:fs";
import type { PageAgentRunRepository } from "@/backend/database/repositories/agent/PageAgentRunRepository";
import type { AgentRunRecordKey } from "@/backend/database/repositories/project/ProjectDeletionFiles";
import type { ArchiveAgentStep } from "@/backend/agents/PageAgentRecordInput";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  PageAgentRunRecord,
  PageAgentRunStatus,
} from "@/definition/PageAgent";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";

const CANCELLED_RESULT = "The run was stopped before it finished.";
/** The file of a record: the SHA-256 of its plan run and step, see {@link runIdentifier}. */
const RECORD_FILE = /^([a-f0-9]{64})\.md$/u;
const ARTIFACT_ID = /^[a-zA-Z0-9-]{1,100}$/u;

type ArchiveRepository = Pick<
  PageAgentRunRepository,
  | "pinInput"
  | "findInput"
  | "find"
  | "save"
  | "discardInput"
  | "markArchived"
  | "unarchived"
  | "snapshotText"
  | "keys"
  | "get"
>;

/**
 * Decides how a step run ended, or that it has no run to record.
 *
 * @remarks
 * A step that waits, is blocked, or was cancelled before its adapter started
 * never ran, so it has no record.
 */
function settledStatus(result: AgentPlanStepResult): PageAgentRunStatus | null {
  if (result.status === "succeeded") return "succeeded";
  if (result.status === "cancelled")
    return result.cancellation === "confirmed" ? "cancelled" : null;
  if (result.status === "failed")
    return result.error === "timeout" || result.error === "check_timeout"
      ? "timeout"
      : "failed";
  return null;
}

function runIdentifier(planRunId: string, stepId: string): string {
  return createHash("sha256").update(`${planRunId}\n${stepId}`).digest("hex");
}

/** The entries of a real directory; a missing or linked one has none. */
async function realEntries(directory: string): Promise<Dirent[]> {
  const entry = await lstat(directory).catch((error: unknown) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw error;
  });
  if (!entry?.isDirectory()) return [];
  return readdir(directory, { withFileTypes: true });
}

/**
 * Persists the dispatched prompt and result only, without scanning workspace files.
 */
export class AgentRunArchive {
  private readonly repository: ArchiveRepository;
  private readonly directory: string;

  public constructor(repository: ArchiveRepository, directory: string) {
    this.repository = repository;
    this.directory = directory;
  }

  /** Records the prompt and the start time before the adapter starts, with pasted credentials redacted. */
  public async input(
    planRunId: string,
    stepId: string,
    prompt: string,
  ): Promise<void> {
    await this.repository.pinInput(planRunId, stepId, {
      prompt: sanitizeArtifactText(prompt),
      startedAt: new Date().toISOString(),
    });
  }

  /**
   * Returns the prompt one node was sent, for the executor of the run.
   *
   * @param userId - The executor; another person gets nothing.
   * @param step - The plan run, the node and its agent.
   * @returns The redacted prompt, or `null` before the node was sent anything.
   *
   * @remarks
   * While the node runs the pinned prompt answers; afterwards its record does.
   */
  public async sentPrompt(
    userId: string,
    step: {
      readonly planRunId: string;
      readonly stepId: string;
      readonly agentId: string;
    },
  ): Promise<string | null> {
    const pinned = await this.repository.findInput(step.planRunId, step.stepId);
    if (pinned) return pinned.prompt;
    requireArtifactId(step.agentId);
    const record = await this.repository.find(
      step.agentId,
      runIdentifier(step.planRunId, step.stepId),
    );
    return record?.userId === userId ? record.input : null;
  }

  /**
   * Records every run of a plan that has ended since the last call.
   *
   * @param run - Current persisted view of the plan run.
   * @param snapshot - The frozen plan the run executes.
   *
   * @remarks
   * Never throws: a file or database problem must not disturb the plan run.
   * The records are repaired by the next call and at startup.
   */
  public async complete(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
  ): Promise<void> {
    await this.report(`write the run records of plan run ${run.id}`, () =>
      this.archive(run, readArchiveSteps(snapshot)),
    );
  }

  /**
   * Repairs missing records and files of ended runs, without provider calls.
   *
   * @remarks
   * Runs at startup and never throws. Plan runs that ended before the records
   * existed are not part of it; a record whose file was lost is written again.
   */
  public async recover(): Promise<void> {
    await this.report("repair the agent run records", async () => {
      for (const stored of await this.repository.unarchived())
        await this.report(
          `write the run records of plan run ${stored.id}`,
          async () =>
            this.archive(
              readPlanRun(JSON.parse(stored.viewJson) as unknown),
              readArchiveSteps(
                JSON.parse(
                  await this.repository.snapshotText(stored.snapshotJson),
                ) as unknown,
              ),
            ),
        );
      const keys = await this.repository.keys();
      for (const { agentId, runId } of keys)
        await this.report(`write the run record file ${runId}`, () =>
          this.restoreFile(agentId, runId),
        );
      await this.report("remove run record files without a record", () =>
        this.removeOrphanedFiles(keys),
      );
    });
  }

  /**
   * Returns a record and its markdown for the executor of the run.
   *
   * @param userId - Authenticated requester; only the executor reads a record.
   * @param agentId - Agent identifier from the request.
   * @param runId - Run identifier from the request.
   * @throws {AgentError} `agent_usage_denied` for a record that does not exist
   * and for one of another executor, so the answer reveals nothing about it.
   *
   * @remarks
   * Delivery additionally requires the current agent and plan authorization,
   * which the route checks before it calls this method.
   */
  public async read(
    userId: string,
    agentId: string,
    runId: string,
  ): Promise<{
    readonly record: PageAgentRunRecord;
    readonly markdown: string;
  }> {
    requireArtifactId(agentId);
    requireArtifactId(runId);
    const record = await this.repository.find(agentId, runId);
    if (!record || record.userId !== userId)
      throw new AgentError("agent_usage_denied");
    // The record is the truth; a file that cannot be written does not keep it from its executor.
    await this.report(`write the run record file ${runId}`, async () => {
      await this.materialize(record);
    });
    return { record, markdown: renderAgentRunRecord(record) };
  }

  /**
   * Removes the markdown files of run records that were deleted with their project.
   *
   * @param keys - The agent and run of each record.
   * @throws {AgentError} `profile_invalid` for an identifier that is no artifact name.
   *
   * @remarks
   * The records are gone from the database, so nothing writes these files
   * again. A file that does not exist is ignored.
   */
  public async removeRecordFiles(
    keys: readonly AgentRunRecordKey[],
  ): Promise<void> {
    for (const { agentId, runId } of keys) {
      requireArtifactId(agentId);
      requireArtifactId(runId);
    }
    for (const { agentId, runId } of keys)
      await rm(this.recordPath(agentId, runId), { force: true });
  }

  private async archive(
    run: AgentPlanRun,
    steps: readonly ArchiveAgentStep[],
  ): Promise<void> {
    for (const step of steps) {
      const result = run.steps.find((entry) => entry.id === step.stepId);
      if (!result) continue;
      const status = settledStatus(result);
      if (status === null) continue;
      const pinned = await this.repository.findInput(run.id, step.stepId);
      const record = await this.repository.save({
        agentId: step.agentId,
        runId: runIdentifier(run.id, step.stepId),
        planRunId: run.id,
        userId: run.userId,
        startedAt: pinned?.startedAt ?? run.startedAt,
        finishedAt: new Date().toISOString(),
        status,
        model: step.model,
        reasoningEffort: step.reasoningEffort,
        input: pinned?.prompt ?? sanitizeArtifactText(step.input),
        result: sanitizeArtifactText(
          result.output ?? result.error ?? CANCELLED_RESULT,
        ),
      });
      await this.repository.discardInput(run.id, step.stepId);
      await this.materialize(record);
    }
    if (!isActivePlanRun(run.status))
      await this.repository.markArchived(run.id);
  }

  private async restoreFile(agentId: string, runId: string): Promise<void> {
    requireArtifactId(agentId);
    requireArtifactId(runId);
    if (await artifactExists(this.recordPath(agentId, runId))) return;
    await this.materialize(await this.repository.get(agentId, runId));
  }

  /**
   * Removes the record files whose record is gone.
   *
   * @remarks
   * A new run of a plan deletes the records of its earlier runs in the
   * database (PAGE-255); their files lie outside the data directory and go
   * here. Only files named like a record below `<agent>/runs` are touched.
   */
  private async removeOrphanedFiles(
    keys: readonly AgentRunRecordKey[],
  ): Promise<void> {
    const known = new Set(keys.map((key) => `${key.agentId}/${key.runId}`));
    for (const agent of await realEntries(this.directory)) {
      if (!agent.isDirectory() || !ARTIFACT_ID.test(agent.name)) continue;
      await this.removeOrphanedAgentFiles(agent.name, known);
    }
  }

  private async removeOrphanedAgentFiles(
    agentId: string,
    known: ReadonlySet<string>,
  ): Promise<void> {
    const runs = path.join(this.directory, agentId, "runs");
    for (const entry of await realEntries(runs)) {
      const runId = RECORD_FILE.exec(entry.name)?.[1];
      if (!entry.isFile() || !runId || known.has(`${agentId}/${runId}`))
        continue;
      await rm(path.join(runs, entry.name), { force: true });
    }
  }

  private recordPath(agentId: string, runId: string): string {
    return path.join(this.directory, agentId, "runs", `${runId}.md`);
  }

  /** A problem is reported and left for the next repair, so one record cannot stop the others. */
  private async report(
    action: string,
    work: () => Promise<void>,
  ): Promise<void> {
    try {
      await work();
    } catch (error: unknown) {
      logCaughtError("AgentRunArchive", error);

      logDiagnostic(
        "AgentRunArchive",
        "error",
        "Pages could not complete an agent run archive operation.",
        error,
      );
    }
  }

  private async materialize(record: PageAgentRunRecord): Promise<string> {
    requireArtifactId(record.runId);
    await artifactDirectory(this.directory, [record.agentId, "runs"]);
    const markdown = renderAgentRunRecord(record);
    await writeArtifact(
      this.recordPath(record.agentId, record.runId),
      markdown,
    );
    return markdown;
  }
}
