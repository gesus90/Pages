import { readAgentObject } from "@/backend/agents/AgentPayload";
import { AgentError } from "@/backend/error/AgentErrors";
import { logEvent } from "@/backend/logging/Logger";
import { MAX_ZAI_QUOTA_WINDOWS } from "@/definition/ZaiCodingPlanQuota";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type {
  ZaiCodingPlanQuotaWindow,
  ZaiQuotaMeasure,
  ZaiWindowLength,
  ZaiWindowUnit,
} from "@/definition/ZaiCodingPlanQuota";
import type {
  ProviderHttpResponse,
  ProviderHttpTransport,
} from "./ProviderContracts";

/** The model-free quota endpoint of the official Z.AI usage client. */
const QUOTA_LIMIT_URL = "https://api.z.ai/api/monitor/usage/quota/limit";

/**
 * The `unit` codes whose meaning a captured answer proves.
 * @remarks
 * Z.AI documents no mapping. A captured answer reports the 5-hour token
 * window as unit 3 with number 5, the weekly token window as unit 6 with
 * number 1 and the MCP window, which the official client calls "1 Month", as
 * unit 5 with number 1. Any other code leaves the length unknown.
 */
const UNIT_BY_CODE: ReadonlyMap<number, ZaiWindowUnit> = new Map([
  [3, "hours"],
  [5, "months"],
  [6, "weeks"],
]);

const MEASURE_BY_TYPE: ReadonlyMap<string, ZaiQuotaMeasure> = new Map([
  ["TOKENS_LIMIT", "tokens"],
  ["TIME_LIMIT", "mcp"],
]);

/** Envelope codes of a missing, invalid or expired key in an HTTP 200 answer. */
const AUTH_ENVELOPE_CODES: ReadonlySet<number> = new Set([
  401, 1000, 1001, 1002, 1003, 1004,
]);

/**
 * Epoch milliseconds before 2001-09-09; a smaller `nextResetTime` would be
 * seconds or a placeholder such as 0, so it names no reset Pages can trust.
 */
const MIN_RESET_EPOCH_MS = 1_000_000_000_000;

/** Numbers Z.AI may send as text, such as `"12.5"`. */
const NUMERIC_TEXT = /^\d+(?:\.\d+)?$/u;

/** An ISO time with a date and a clock time, such as `2026-11-24T16:00:00Z`. */
const ISO_TIME_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u;

/** A `type` Pages may name in its log; anything else reads as `other`. */
const LOGGABLE_TYPE = /^[A-Z][A-Z0-9_]{0,39}$/u;

/** What Z.AI reported for one Coding Plan key. */
export interface ZaiCodingPlanUsage {
  /** The reported subscription level, such as `pro`; `null` when none was reported. */
  readonly plan: string | null;
  readonly windows: readonly ZaiCodingPlanQuotaWindow[];
  /** The reported entries Pages could not read as a window. */
  readonly unreadableCount: number;
}

/** A window before Pages gives it a key. */
type ReportedWindow = Omit<ZaiCodingPlanQuotaWindow, "key">;

/**
 * Why an entry of the answer is no window of the card: not an object, an
 * unknown type without a used share, or an MCP entry that names neither its
 * own length nor its own reset and so proves no window of its own.
 */
type OmittedReason = "not_object" | "unknown_type" | "mcp_without_window";

type EntryReading =
  | { readonly kind: "window"; readonly window: ReportedWindow }
  | { readonly kind: "omitted"; readonly reason: OmittedReason };

/** A quota answer as Pages read it, with a summary of every entry for the log. */
interface QuotaAnswerReading {
  readonly usage: ZaiCodingPlanUsage;
  readonly entries: readonly string[];
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  return NUMERIC_TEXT.test(text) ? Number(text) : null;
}

function readCount(value: unknown): number | null {
  const count = readNumber(value);
  return count !== null && count >= 0 ? count : null;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/**
 * The used share as reported, or from the reported used or remaining count
 * and the reported limit; `null` when the answer allows neither.
 */
function readUsedPercent(entry: Record<string, unknown>): number | null {
  const percentage = readNumber(entry.percentage);
  if (percentage !== null) return clampPercent(percentage);
  const limit = readCount(entry.usage);
  if (limit === null || limit === 0) return null;
  const used = readCount(entry.currentValue);
  if (used !== null) return clampPercent((used / limit) * 100);
  const remaining = readCount(entry.remaining);
  if (remaining === null) return null;
  return clampPercent(((limit - remaining) / limit) * 100);
}

function readResetsAt(value: unknown): string | null {
  const epoch =
    typeof value === "string" && ISO_TIME_TEXT.test(value.trim())
      ? Date.parse(value.trim())
      : readNumber(value);
  if (epoch === null || !Number.isFinite(epoch)) return null;
  if (epoch < MIN_RESET_EPOCH_MS) return null;
  const reset = new Date(epoch);
  return Number.isNaN(reset.getTime()) ? null : reset.toISOString();
}

function readLength(unit: unknown, count: unknown): ZaiWindowLength | null {
  const unitCode = readNumber(unit);
  const length = readNumber(count);
  if (unitCode === null || length === null) return null;
  const known = UNIT_BY_CODE.get(unitCode);
  if (!known || !Number.isInteger(length) || length <= 0) return null;
  return { unit: known, count: length };
}

function readMeasure(type: unknown): ZaiQuotaMeasure {
  if (typeof type !== "string") return "quota";
  return MEASURE_BY_TYPE.get(type) ?? "quota";
}

/**
 * One entry of the answer as a window, or why it is none.
 * @remarks
 * An entry of a known type stays a window even without a used share, length
 * or reset, which the card then shows as unknown. An entry of an unknown
 * type is a window only with a used share. The MCP entry stands as a window
 * of its own only when it names its own length or reset; otherwise it
 * proves no window apart from the token credits.
 */
function readEntry(entry: unknown): EntryReading {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry))
    return { kind: "omitted", reason: "not_object" };
  const fields = readAgentObject(entry);
  const measure = readMeasure(fields.type);
  const usedPercent = readUsedPercent(fields);
  if (measure === "quota" && usedPercent === null)
    return { kind: "omitted", reason: "unknown_type" };
  const length = readLength(fields.unit, fields.number);
  const resetsAt = readResetsAt(fields.nextResetTime);
  if (measure === "mcp" && length === null && resetsAt === null)
    return { kind: "omitted", reason: "mcp_without_window" };
  const window: ReportedWindow = {
    measure,
    length,
    usedPercent,
    used: readCount(fields.currentValue),
    limit: readCount(fields.usage),
    remaining: readCount(fields.remaining),
    resetsAt,
  };
  return { kind: "window", window };
}

function loggableType(type: unknown): string {
  if (typeof type !== "string") return "none";
  return LOGGABLE_TYPE.test(type) ? type : "other";
}

/** Whether a readable reset lies ahead of the answer (`+`), behind it (`-`) or is unknown (`?`). */
function resetState(value: unknown): string {
  const reset = readResetsAt(value);
  if (reset === null) return "reset?";
  return Date.parse(reset) > Date.now() ? "reset+" : "reset-";
}

/**
 * A line of the log about one entry, without any reported value.
 * @remarks
 * It names the type, how Pages read the entry, the raw unit and number
 * codes, which figures were present and whether a readable reset lies ahead
 * of or behind the answer, so a missing bar can be explained without the
 * answer itself.
 */
function entrySummary(entry: unknown, reading: EntryReading): string {
  const fields = readAgentObject(entry);
  const outcome = reading.kind === "window" ? "window" : reading.reason;
  const reported: readonly (readonly [string, unknown])[] = [
    ["pct", fields.percentage],
    ["cur", fields.currentValue],
    ["lim", fields.usage],
    ["rem", fields.remaining],
  ];
  const figures = reported
    .filter(([, value]) => readNumber(value) !== null)
    .map(([name]) => name)
    .join(",");
  const unit = readNumber(fields.unit) ?? "?";
  const count = readNumber(fields.number) ?? "?";
  return [
    loggableType(fields.type),
    outcome,
    `u${unit}n${count}`,
    figures || "nofigures",
    resetState(fields.nextResetTime),
  ].join("/");
}

function windowKey(window: ReportedWindow, taken: Set<string>): string {
  const length = window.length
    ? `${window.length.count}${window.length.unit}`
    : "unknown";
  const base = `${window.measure}-${length}`;
  let key = base;
  for (let index = 2; taken.has(key); index += 1) key = `${base}-${index}`;
  taken.add(key);
  return key;
}

function readPlan(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const plan = value.trim();
  return plan.length > 0 && plan.length <= 40 ? plan : null;
}

function envelopeFailure(
  envelope: Record<string, unknown>,
): AgentErrorCode | null {
  const { code, success } = envelope;
  if (typeof code === "number" && AUTH_ENVELOPE_CODES.has(code))
    return "provider_auth_failed";
  if (success === false) return "provider_bad_response";
  if (typeof code === "number" && code !== 200) return "provider_bad_response";
  return null;
}

function readQuotaAnswer(payload: unknown): QuotaAnswerReading {
  const envelope = readAgentObject(payload);
  const failure = envelopeFailure(envelope);
  if (failure) throw new AgentError(failure);
  const quota = readAgentObject(envelope.data);
  if (!Array.isArray(quota.limits))
    throw new AgentError("provider_bad_response");
  const limits: readonly unknown[] = quota.limits;
  const entries = limits.map((entry) => {
    const reading = readEntry(entry);
    return { reading, summary: entrySummary(entry, reading) };
  });
  const readings = entries.map((entry) => entry.reading);
  const taken = new Set<string>();
  const windows = readings
    .flatMap((reading) => (reading.kind === "window" ? [reading.window] : []))
    .sort(
      (first, second) =>
        Number(first.measure === "mcp") - Number(second.measure === "mcp"),
    )
    .slice(0, MAX_ZAI_QUOTA_WINDOWS)
    .map((window) => ({ key: windowKey(window, taken), ...window }));
  const unreadableCount = readings.filter(
    (reading) =>
      reading.kind === "omitted" && reading.reason !== "mcp_without_window",
  ).length;
  return {
    usage: { plan: readPlan(quota.level), windows, unreadableCount },
    entries: entries.map((entry) => entry.summary),
  };
}

/**
 * Reads the windows and the plan of a quota answer.
 * @param payload - The parsed JSON body of the answer.
 * @returns The plan, the windows, token windows before the MCP window, and
 * the number of entries Pages could not read.
 * @throws {AgentError} `provider_auth_failed` for a rejected key,
 * `provider_bad_response` for an answer without a list of limits.
 */
export function readZaiCodingPlanUsage(payload: unknown): ZaiCodingPlanUsage {
  return readQuotaAnswer(payload).usage;
}

/**
 * Logs how Pages read an answer, without the key or any reported value.
 * @remarks
 * An answer without a window or with an entry Pages cannot read is logged
 * as information, so the reason for a card without bars stays traceable in
 * the operations log; every other answer only at debug level.
 */
function logQuotaAnswer(reading: QuotaAnswerReading): void {
  const { usage, entries } = reading;
  const omitted = entries.length - usage.windows.length;
  logEvent({
    level:
      usage.windows.length === 0 || usage.unreadableCount > 0
        ? "info"
        : "debug",
    event: "integration.provider.quota_read",
    component: "ZaiCodingPlanUsageClient",
    message: "Z.AI quota answer read",
    metadata: {
      provider: "zai-coding-plan",
      evaluatedEntries: entries.length,
      deliveredEntries: usage.windows.length,
      unsupportedEntries: usage.unreadableCount,
      hiddenEntries: omitted - usage.unreadableCount,
      diagnostic: entries.join(";"),
    },
  });
}

function statusFailure(status: number): AgentErrorCode | null {
  if (status === 401 || status === 403) return "provider_auth_failed";
  if (status === 429) return "provider_rate_limited";
  if (status >= 500) return "provider_unavailable";
  if (status < 200 || status >= 300) return "provider_request_rejected";
  return null;
}

/**
 * Asks Z.AI for the quota of a Coding Plan key, without asking a model.
 * @remarks
 * The request is the GET of the official usage client. It starts no model
 * turn, so it uses none of the credits it reads, and it does not touch a
 * running session of the same key. The key travels only in the header, a
 * redirect is refused so it cannot reach another host, and neither the key
 * nor the body of the answer is logged or returned.
 */
export class ZaiCodingPlanUsageClient {
  private readonly request: ProviderHttpTransport;

  public constructor(request: ProviderHttpTransport = fetch) {
    this.request = request;
  }

  /**
   * Reads the current quota of a key.
   * @param apiKey - The Coding Plan key of the connection.
   * @param signal - Deadline of the query.
   * @returns The plan and the windows Z.AI reported.
   * @throws {AgentError} The classified failure of the query.
   */
  public async read(
    apiKey: string,
    signal: AbortSignal,
  ): Promise<ZaiCodingPlanUsage> {
    const response = await this.send(apiKey, signal);
    const failure = statusFailure(response.status);
    if (failure) throw new AgentError(failure);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AgentError(
        signal.aborted ? "check_timeout" : "provider_bad_response",
      );
    }
    if (signal.aborted) throw new AgentError("check_timeout");
    const reading = readQuotaAnswer(payload);
    logQuotaAnswer(reading);
    return reading.usage;
  }

  private async send(
    apiKey: string,
    signal: AbortSignal,
  ): Promise<ProviderHttpResponse> {
    try {
      signal.throwIfAborted();
      const response = await this.request(QUOTA_LIMIT_URL, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Language": "en-US,en",
          Authorization: apiKey,
        },
        signal,
        redirect: "error",
      });
      logEvent({
        level: response.status < 400 ? "debug" : "warn",
        event: "integration.provider.response",
        component: "ZaiCodingPlanUsageClient",
        message: "Z.AI quota response received",
        metadata: { provider: "zai-coding-plan", statusCode: response.status },
      });
      return response;
    } catch (error: unknown) {
      if (error instanceof AgentError) throw error;
      throw new AgentError(
        signal.aborted ? "check_timeout" : "provider_unreachable",
      );
    }
  }
}
