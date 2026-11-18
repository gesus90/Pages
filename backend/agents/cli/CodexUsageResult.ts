import { readAgentObject } from "@/backend/agents/AgentPayload";
import { providerResetTimestamp } from "@/backend/agents/providers/ProviderReset";
import { AgentError } from "@/backend/error/AgentErrors";
import { CODEX_QUOTA_WINDOWS, readCodexPlan } from "@/definition/CodexQuota";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type {
  CodexQuotaWindow,
  CodexQuotaWindowKind,
} from "@/definition/CodexQuota";
import type { CodexQuotaReading } from "@/backend/database/repositories/agent/CodexQuotaRepository";

/** The id of the `initialize` request of the usage query. */
export const CODEX_INITIALIZE_REQUEST_ID = 1;

/** The id under which Pages asks the app server for `account/rateLimits/read`. */
export const CODEX_USAGE_REQUEST_ID = 2;

/**
 * What one `account/rateLimits/read` query of a Codex connection answered.
 * @remarks
 * It holds only the general Codex quota: the plan the account reports, the
 * windows `primary` and `secondary` as far as the app server named them, and
 * whether the account states that its limit is reached. Credits, reset
 * credits and the quotas of single models are not read.
 */
export type CodexUsageReading = CodexQuotaReading;

/** Failures the app server names with a message; a code and no text leave this module. */
const NOT_SIGNED_IN =
  /authentication required|not (?:logged|signed) in|log ?in required|sign ?in required/iu;
const SIGN_IN_REJECTED =
  /\b401\b|unauthorized|token.{0,40}(?:expired|invalid|revoked)|refresh token|(?:log|sign) ?in again/iu;

function readLine(line: string): Record<string, unknown> {
  try {
    return readAgentObject(JSON.parse(line));
  } catch {
    // The app server may print other lines; only JSON-RPC messages count.
    return {};
  }
}

/** A response, not a request or notification of the server, to the usage request. */
function isUsageResponse(entry: Record<string, unknown>): boolean {
  return (
    entry.id === CODEX_USAGE_REQUEST_ID &&
    entry.method === undefined &&
    (entry.result !== undefined || entry.error !== undefined)
  );
}

/**
 * Whether a line of the app server output is its answer to the usage request.
 * @param line - One JSON-RPC line.
 */
export function isCodexUsageAnswer(line: string): boolean {
  return isUsageResponse(readLine(line));
}

/**
 * Tells what a failed query says about the sign-in.
 * @remarks
 * Only the message is read, never logged or passed on: a connection without
 * a ChatGPT sign-in is signed out, a sign-in the server rejected needs a new
 * login, everything else is a failed query that another attempt may fix.
 */
function failureCode(error: Record<string, unknown>): AgentErrorCode {
  const message = typeof error.message === "string" ? error.message : "";
  if (NOT_SIGNED_IN.test(message)) return "cli_not_logged_in";
  if (SIGN_IN_REJECTED.test(message)) return "cli_auth_failed";
  return "cli_check_failed";
}

function readWindow(
  kind: CodexQuotaWindowKind,
  reported: unknown,
): CodexQuotaWindow | null {
  const window = readAgentObject(reported);
  const { usedPercent, windowDurationMins } = window;
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent))
    return null;
  const hasDuration =
    typeof windowDurationMins === "number" &&
    Number.isInteger(windowDurationMins) &&
    windowDurationMins > 0;
  return {
    kind,
    usedPercent: Math.min(100, Math.max(0, Math.round(usedPercent))),
    durationMinutes: hasDuration ? windowDurationMins : null,
    resetsAt: providerResetTimestamp(window.resetsAt),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Picks the snapshot of the general Codex quota out of the answer.
 * @returns `rateLimitsByLimitId.codex` when it exists; otherwise the
 * single-bucket `rateLimits` when it belongs to the general quota, that is
 * when it names the limit `codex` or names none while the answer has no
 * per-limit view; otherwise `null`.
 * @remarks
 * A snapshot of another limit is the quota of a single model and never
 * stands in for the general one.
 */
function generalSnapshot(
  result: Record<string, unknown>,
): Record<string, unknown> | null {
  const byLimitId = result.rateLimitsByLimitId;
  if (isObject(byLimitId) && isObject(byLimitId.codex)) return byLimitId.codex;
  const compatible = result.rateLimits;
  if (!isObject(compatible)) return null;
  if (compatible.limitId === "codex") return compatible;
  const isUnnamed =
    compatible.limitId === null || compatible.limitId === undefined;
  return isUnnamed && !isObject(byLimitId) ? compatible : null;
}

/**
 * Reads the answer of the app server to `account/rateLimits/read`.
 * @param stdout - The JSON-RPC lines the app server printed.
 * @returns The plan, the windows and the limit statement of the general quota.
 * @throws {AgentError} `cli_unexpected_output` when the server did not
 * answer the request, `cli_not_logged_in` or `cli_auth_failed` when it names
 * the missing or rejected sign-in, `cli_check_failed` for any other error.
 */
export function readCodexUsage(stdout: string): CodexUsageReading {
  const message = stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(readLine)
    .find(isUsageResponse);
  if (message === undefined) throw new AgentError("cli_unexpected_output");
  if (message.error !== undefined)
    throw new AgentError(failureCode(readAgentObject(message.error)));
  const result = readAgentObject(message.result);
  const snapshot = generalSnapshot(result);
  const isLimitReached =
    result.ordinaryUsageAllowed === false ||
    (snapshot !== null &&
      typeof snapshot.rateLimitReachedType === "string" &&
      snapshot.rateLimitReachedType !== "");
  if (snapshot === null) return { plan: null, windows: [], isLimitReached };
  const windows = CODEX_QUOTA_WINDOWS.map((kind) =>
    readWindow(kind, snapshot[kind]),
  ).filter((window): window is CodexQuotaWindow => window !== null);
  return { plan: readCodexPlan(snapshot.planType), windows, isLimitReached };
}
