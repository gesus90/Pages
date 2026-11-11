import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AGENT_RUN_DIAGNOSIS_LIMITS } from "@/definition/AgentRunDiagnosis";
import { readRunStatus } from "@/backend/database/repositories/agent/AgentPlanRunVisibilityRepository";

import { createAgentCursor, readAgentCursor } from "../AgentCursor";
import { agentRunErrorHint } from "./AgentRunErrorClassifier";
import {
  readFailureSummaryRequest,
  readRunListRequest,
  readRunLogRequest,
  readRunTimelineRequest,
} from "./AgentRunDiagnosisInput";
import { filterRunLogMessage } from "./AgentRunLogRecorder";
import { buildRunTimeline } from "./RunTimeline";

import type { AgentRunActivityRepository } from "@/backend/database/repositories/diagnosis/AgentRunActivityRepository";
import type { AgentRunDiagnosisSettingsRepository } from "@/backend/database/repositories/diagnosis/AgentRunDiagnosisSettingsRepository";
import type {
  AgentRunFailureRepository,
  RunSearchFilters,
} from "@/backend/database/repositories/diagnosis/AgentRunFailureRepository";
import type {
  AgentRunLogRepository,
  RunLogRow,
} from "@/backend/database/repositories/diagnosis/AgentRunLogRepository";
import type { AgentPlanSummary } from "@/definition/AgentPlan";
import type {
  AgentRunFailureSummary,
  AgentRunLogEntry,
  AgentRunList,
  AgentRunLogPage,
  AgentRunTimeline,
  AgentRunStarter,
} from "@/definition/AgentRunDiagnosis";
import type { AgentPlanRunTeamReader } from "./AgentPlanRunTeamReader";
import type { AgentRunFailureIndexer } from "./AgentRunFailureIndexer";

/** The stores and checks the diagnosis reads with. */
export interface AgentRunDiagnosisParts {
  readonly reader: AgentPlanRunTeamReader;
  /** The plans the person may see, as the plan page lists them. */
  readonly plans: {
    summaries(userId: string): Promise<readonly AgentPlanSummary[]>;
  };
  readonly failures: AgentRunFailureRepository;
  readonly indexer: AgentRunFailureIndexer;
  readonly logs: AgentRunLogRepository;
  readonly activity: AgentRunActivityRepository;
  readonly settings: Pick<AgentRunDiagnosisSettingsRepository, "read">;
  readonly now?: () => number;
}

/** A response may not exceed this size, so a page of log lines stops before it. */
const RESPONSE_BUDGET_BYTES = 900_000;

function offsetOf(cursor: string | null, context: string): number {
  if (cursor === null) return 0;
  const after = readAgentCursor({ cursor, context });
  const offset = Number(after);
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: "cursor_invalid",
    });
  return offset;
}

interface LogPageFit {
  readonly entries: readonly AgentRunLogEntry[];
  /** The identifier of the last line that fits, where the next page continues. */
  readonly last: number;
  /** Lines were left for the next page to stay below the size of a response. */
  readonly isCut: boolean;
  readonly isTruncated: boolean;
  readonly hasHidden: boolean;
}

/** Shows what the reader may see of the stored lines and stops before the response gets too large. */
function fitLogPage(
  rows: readonly RunLogRow[],
  hidesCli: boolean,
  after: number,
): LogPageFit {
  const entries: AgentRunLogEntry[] = [];
  let bytes = 0;
  let last = after;
  let isCut = false;
  let isTruncated = false;
  let hasHidden = false;
  for (const row of rows) {
    const filtered = filterRunLogMessage(row.message);
    bytes += Buffer.byteLength(filtered.message) + 200;
    if (bytes > RESPONSE_BUDGET_BYTES && entries.length > 0) {
      isCut = true;
      break;
    }
    const isHidden = hidesCli && row.source === "cli";
    hasHidden ||= isHidden;
    isTruncated ||= filtered.message.endsWith("[TRUNCATED]");
    last = row.id;
    entries.push({
      at: row.at,
      level: row.level,
      source: row.source,
      stepId: row.stepId,
      attemptId: row.attemptId,
      ...(isHidden ? {} : { message: filtered.message }),
      isFiltered: row.isFiltered || filtered.isFiltered || isHidden,
    });
  }
  return { entries, last, isCut, isTruncated: isTruncated || isCut, hasHidden };
}

/**
 * The diagnosis of runs for everybody who may read their plan (PAGE-307).
 *
 * @remarks
 * Every read first resolves what the person may see through the same plan
 * rights as the plan page; a run of a plan outside them is as good as
 * missing. Starting, stopping and the other controls are not part of it.
 */
export class AgentRunDiagnosisService {
  private readonly parts: AgentRunDiagnosisParts;

  public constructor(parts: AgentRunDiagnosisParts) {
    this.parts = parts;
  }

  /**
   * Lists the plans the person may see, for the filters of the run view.
   *
   * @param userId - The reader.
   */
  public async visiblePlans(
    userId: string,
  ): Promise<
    readonly Pick<
      AgentPlanSummary,
      "id" | "name" | "projectId" | "projectName"
    >[]
  > {
    return (await this.parts.plans.summaries(userId)).map((plan) => ({
      id: plan.id,
      name: plan.name,
      projectId: plan.projectId,
      projectName: plan.projectName,
    }));
  }

  /**
   * Lists the runs of every plan the person may see, newest first.
   *
   * @param userId - The reader.
   * @param input - The raw parameters of `list_runs`.
   * @throws {AgentOperationError} `INVALID_REQUEST` for a bad parameter, `NOT_FOUND` for a plan the person cannot see.
   */
  public async listRuns(userId: string, input: unknown): Promise<AgentRunList> {
    const request = readRunListRequest(input);
    const filters = await this.filters(userId, request);
    await this.parts.indexer.refresh();
    const context = JSON.stringify([userId, "runs.list", filters]);
    const offset = offsetOf(request.cursor, context);
    const [total, rows] = await Promise.all([
      this.parts.failures.count(filters),
      this.parts.failures.search(filters, { offset, limit: request.limit }),
    ]);
    const starters = await this.starters(rows.map((row) => row.startedById));
    const runs = rows.map((row) => ({
      runId: row.runId,
      planId: row.planId,
      planName: row.planName,
      projectId: row.projectId,
      status: readRunStatus(row.status),
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      startedBy: starters.get(row.startedById) ?? {
        id: row.startedById,
        displayName: row.startedById,
      },
      failedStepId: row.failedStepId,
      errorClass: row.errorClass,
      errorCode: row.errorCode,
    }));
    const next = offset + rows.length;
    return {
      runs,
      total,
      nextCursor:
        next < total && rows.length > 0
          ? createAgentCursor(context, String(next))
          : null,
      hiddenFields: [],
    };
  }

  /**
   * Counts the failed steps of the visible plans, grouped.
   *
   * @param userId - The reader.
   * @param input - The raw parameters of `summarize_run_failures`.
   * @throws {AgentOperationError} `INVALID_REQUEST` for a bad parameter, `NOT_FOUND` for a plan the person cannot see.
   */
  public async summarizeFailures(
    userId: string,
    input: unknown,
  ): Promise<AgentRunFailureSummary> {
    const request = readFailureSummaryRequest(input);
    const filters = await this.filters(userId, {
      ...request,
      status: null,
      stepId: null,
      errorClass: null,
      startedById: null,
    });
    await this.parts.indexer.refresh();
    const [rows, totalFailedSteps] = await Promise.all([
      this.parts.failures.groups(filters, request.groupBy, request.limit),
      this.parts.failures.totalFailedSteps(filters),
    ]);
    return {
      groups: rows.map((row) => ({
        errorClass: row.errorClass,
        planId: row.planId,
        planName: row.planName,
        stepId: row.stepId,
        stepLabel: row.stepLabel,
        count: row.count,
        firstAt: row.firstAt,
        lastAt: row.lastAt,
        exampleRunIds: row.exampleRunIds.slice(
          0,
          AGENT_RUN_DIAGNOSIS_LIMITS.exampleRuns,
        ),
        hint:
          row.errorClass === null ? null : agentRunErrorHint(row.errorClass),
      })),
      totalFailedSteps,
      from: request.from,
      to: request.to,
      hiddenFields: [],
    };
  }

  /**
   * Builds the timeline of a run.
   *
   * @param userId - The reader.
   * @param input - The raw parameters: the run.
   * @throws {AgentOperationError} `INVALID_REQUEST` for a bad parameter.
   * @throws {AgentError} `plan_access_denied` for a run the person cannot see.
   */
  public async timeline(
    userId: string,
    input: unknown,
  ): Promise<AgentRunTimeline> {
    const runId = readRunTimelineRequest(input);
    const readable = await this.parts.reader.read(userId, runId);
    const { run } = readable;
    const [activity, settings] = await Promise.all([
      this.parts.activity.read(run.id),
      this.parts.settings.read(),
    ]);
    const { entries, stalled } = buildRunTimeline(run, activity, {
      now: (this.parts.now ?? Date.now)(),
      stallMs: settings.stallMinutes * 60_000,
    });
    return {
      runId: run.id,
      planId: run.planId,
      status: readRunStatus(run.status),
      entries,
      stalled,
      startedBy: readable.startedBy,
      hiddenFields: readable.hiddenFields.includes("steps.name")
        ? ["entries.stepLabel"]
        : [],
    };
  }

  /**
   * Reads one page of the log of a run or step.
   *
   * @param userId - The reader.
   * @param input - The raw parameters of `read_plan_run_logs`.
   * @throws {AgentOperationError} `INVALID_REQUEST` for a bad parameter.
   * @throws {AgentError} `plan_access_denied` for a run the person cannot see.
   */
  public async logs(userId: string, input: unknown): Promise<AgentRunLogPage> {
    const request = readRunLogRequest(input);
    const readable = await this.parts.reader.read(userId, request.runId);
    const { cursor: hiddenCursor, ...query } = request;
    void hiddenCursor;
    const context = JSON.stringify([userId, "runs.logs", query]);
    const after =
      request.cursor === null ? 0 : offsetOf(request.cursor, context);
    const { rows, hasMore } = await this.parts.logs.read({
      runId: readable.run.id,
      stepId: request.stepId,
      attemptId: request.attemptId,
      minimumLevel: request.level,
      from: request.from,
      to: request.to,
      after,
      limit: request.limit,
    });
    // The CLI lines quote the work of the agent, which may hold hidden content.
    const hidesCli = readable.hiddenSources.length > 0;
    const page = fitLogPage(rows, hidesCli, after);
    const hasNext = hasMore || page.isCut;
    return {
      entries: page.entries,
      nextCursor: hasNext
        ? createAgentCursor(context, String(page.last))
        : null,
      isTruncated: page.isTruncated,
      hiddenFields: page.hasHidden ? ["entries.message"] : [],
    };
  }

  private async filters(
    userId: string,
    request: {
      readonly projectId: string | null;
      readonly planId: string | null;
      readonly status: string | null;
      readonly stepId: string | null;
      readonly errorClass: RunSearchFilters["errorClass"];
      readonly startedById: string | null;
      readonly from: string | null;
      readonly to: string | null;
    },
  ): Promise<RunSearchFilters> {
    const visible = await this.parts.plans.summaries(userId);
    if (
      request.planId !== null &&
      !visible.some((plan) => plan.id === request.planId)
    )
      throw new AgentOperationError("NOT_FOUND");
    return {
      planIds: visible
        .filter(
          (plan) =>
            request.projectId === null || plan.projectId === request.projectId,
        )
        .map((plan) => plan.id),
      projectId: request.projectId,
      planId: request.planId,
      status: request.status,
      stepId: request.stepId,
      errorClass: request.errorClass,
      startedById: request.startedById,
      from: request.from,
      to: request.to,
    };
  }

  /** Names each starter once per request, so a changed name shows at once. */
  private async starters(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, AgentRunStarter>> {
    const unique = [...new Set(userIds)];
    const named = await Promise.all(
      unique.map((id) => this.parts.reader.describeStarter(id)),
    );
    return new Map(named.map((starter) => [starter.id, starter]));
  }
}
