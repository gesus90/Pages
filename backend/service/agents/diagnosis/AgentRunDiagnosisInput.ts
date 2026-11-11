import { z } from "zod";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  AGENT_RUN_DIAGNOSIS_LIMITS,
  AGENT_RUN_ERROR_CLASSES,
  AGENT_RUN_LIST_STATUSES,
  AGENT_RUN_LOG_LEVELS,
} from "@/definition/AgentRunDiagnosis";

import type {
  AgentRunErrorClass,
  AgentRunFailureGrouping,
  AgentRunListEntry,
  AgentRunLogLevel,
} from "@/definition/AgentRunDiagnosis";

const IDENTIFIER = z.string().trim().min(1).max(200);
const CURSOR = z.string().min(1).max(2048);

/** An ISO 8601 time, normalized to UTC so stored times compare as text. */
const TIME = z
  .string()
  .max(40)
  .refine((text) => Number.isFinite(Date.parse(text)), "invalid_time")
  .transform((text) => new Date(text).toISOString());

const ERROR_CLASS = z.enum(AGENT_RUN_ERROR_CLASSES);

/** The parameters of `list_runs`. */
const RUN_LIST_INPUT = z
  .object({
    projectId: IDENTIFIER.optional(),
    planId: IDENTIFIER.optional(),
    status: z.enum(AGENT_RUN_LIST_STATUSES).optional(),
    stepId: IDENTIFIER.optional(),
    errorClass: ERROR_CLASS.optional(),
    startedById: IDENTIFIER.optional(),
    from: TIME.optional(),
    to: TIME.optional(),
    cursor: CURSOR.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(AGENT_RUN_DIAGNOSIS_LIMITS.runsMaximum)
      .optional(),
  })
  .strict();

/** The parameters of `summarize_run_failures`. */
const FAILURE_SUMMARY_INPUT = z
  .object({
    projectId: IDENTIFIER.optional(),
    planId: IDENTIFIER.optional(),
    from: TIME.optional(),
    to: TIME.optional(),
    groupBy: z.enum(["errorClass", "plan", "step"]).optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(AGENT_RUN_DIAGNOSIS_LIMITS.failureGroupsMaximum)
      .optional(),
  })
  .strict();

/** The parameters of `read_plan_run_logs` besides the run. */
const RUN_LOG_INPUT = z
  .object({
    runId: IDENTIFIER,
    stepId: IDENTIFIER.optional(),
    attemptId: IDENTIFIER.optional(),
    level: z.enum(AGENT_RUN_LOG_LEVELS).optional(),
    from: TIME.optional(),
    to: TIME.optional(),
    cursor: CURSOR.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(AGENT_RUN_DIAGNOSIS_LIMITS.logsMaximum)
      .optional(),
  })
  .strict();

const RUN_ONLY_INPUT = z.object({ runId: IDENTIFIER }).strict();

/** A validated run list request. */
export interface RunListRequest {
  readonly projectId: string | null;
  readonly planId: string | null;
  readonly status: AgentRunListEntry["status"] | null;
  readonly stepId: string | null;
  readonly errorClass: AgentRunErrorClass | null;
  readonly startedById: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly cursor: string | null;
  readonly limit: number;
}

/** A validated failure overview request. */
export interface FailureSummaryRequest {
  readonly projectId: string | null;
  readonly planId: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly groupBy: AgentRunFailureGrouping;
  readonly limit: number;
}

/** A validated log request. */
export interface RunLogRequest {
  readonly runId: string;
  readonly stepId: string | null;
  readonly attemptId: string | null;
  readonly level: AgentRunLogLevel;
  readonly from: string | null;
  readonly to: string | null;
  readonly cursor: string | null;
  readonly limit: number;
}

function reasonOf(
  error: z.ZodError,
):
  | "unknown_parameter"
  | "limit_out_of_range"
  | "time_invalid"
  | "parameter_invalid" {
  const issue = error.issues[0];
  if (issue?.code === "unrecognized_keys") return "unknown_parameter";
  if (issue?.path[0] === "limit" && issue.code !== "invalid_type")
    return "limit_out_of_range";
  if (issue?.message === "invalid_time") return "time_invalid";
  return "parameter_invalid";
}

function parse<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.infer<Schema> {
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success)
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: reasonOf(parsed.error),
    });
  return parsed.data;
}

function requireOrderedTimes(from: string | null, to: string | null): void {
  if (from !== null && to !== null && from > to)
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: "time_range_reversed",
    });
}

/**
 * Reads the parameters of `list_runs`.
 *
 * @param input - The raw parameters.
 * @throws {AgentOperationError} `INVALID_REQUEST` with a reason.
 */
export function readRunListRequest(input: unknown): RunListRequest {
  const request = parse(RUN_LIST_INPUT, input);
  const from = request.from ?? null;
  const to = request.to ?? null;
  requireOrderedTimes(from, to);
  return {
    projectId: request.projectId ?? null,
    planId: request.planId ?? null,
    status: request.status ?? null,
    stepId: request.stepId ?? null,
    errorClass: request.errorClass ?? null,
    startedById: request.startedById ?? null,
    from,
    to,
    cursor: request.cursor ?? null,
    limit: request.limit ?? AGENT_RUN_DIAGNOSIS_LIMITS.runsDefault,
  };
}

/**
 * Reads the parameters of `summarize_run_failures`.
 *
 * @param input - The raw parameters.
 * @throws {AgentOperationError} `INVALID_REQUEST` with a reason.
 */
export function readFailureSummaryRequest(
  input: unknown,
): FailureSummaryRequest {
  const request = parse(FAILURE_SUMMARY_INPUT, input);
  const from = request.from ?? null;
  const to = request.to ?? null;
  requireOrderedTimes(from, to);
  return {
    projectId: request.projectId ?? null,
    planId: request.planId ?? null,
    from,
    to,
    groupBy: request.groupBy ?? "errorClass",
    limit: request.limit ?? AGENT_RUN_DIAGNOSIS_LIMITS.failureGroupsDefault,
  };
}

/**
 * Reads the parameters of `read_plan_run_logs`.
 *
 * @param input - The raw parameters.
 * @throws {AgentOperationError} `INVALID_REQUEST` with a reason.
 */
export function readRunLogRequest(input: unknown): RunLogRequest {
  const { planId: hiddenPlanId, ...rest } = withoutPlanId(input);
  void hiddenPlanId;
  const request = parse(RUN_LOG_INPUT, rest);
  const from = request.from ?? null;
  const to = request.to ?? null;
  requireOrderedTimes(from, to);
  return {
    runId: request.runId,
    stepId: request.stepId ?? null,
    attemptId: request.attemptId ?? null,
    level: request.level ?? "info",
    from,
    to,
    cursor: request.cursor ?? null,
    limit: request.limit ?? AGENT_RUN_DIAGNOSIS_LIMITS.logsDefault,
  };
}

/**
 * Reads the parameters of `read_plan_run_timeline`.
 *
 * @param input - The raw parameters.
 * @returns The run identifier.
 * @throws {AgentOperationError} `INVALID_REQUEST` with a reason.
 */
export function readRunTimelineRequest(input: unknown): string {
  const { planId: hiddenPlanId, ...rest } = withoutPlanId(input);
  void hiddenPlanId;
  return parse(RUN_ONLY_INPUT, rest).runId;
}

/** A client may name the plan of the run too; the run decides. */
function withoutPlanId(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: "parameter_invalid",
    });
  return { ...input };
}
