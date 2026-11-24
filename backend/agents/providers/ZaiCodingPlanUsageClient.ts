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

/** What Z.AI reported for one Coding Plan key. */
export interface ZaiCodingPlanUsage {
  /** The reported subscription level, such as `pro`; `null` when none was reported. */
  readonly plan: string | null;
  readonly windows: readonly ZaiCodingPlanQuotaWindow[];
}

/** A window before Pages gives it a key. */
type ReportedWindow = Omit<ZaiCodingPlanQuotaWindow, "key">;

function readCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** The used share as reported, or from the reported used count and limit. */
function readUsedPercent(entry: Record<string, unknown>): number | null {
  const percentage = entry.percentage;
  if (typeof percentage === "number" && Number.isFinite(percentage))
    return clampPercent(percentage);
  const used = readCount(entry.currentValue);
  const limit = readCount(entry.usage);
  if (used === null || limit === null || limit === 0) return null;
  return clampPercent((used / limit) * 100);
}

function readResetsAt(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < MIN_RESET_EPOCH_MS) return null;
  const reset = new Date(value);
  return Number.isNaN(reset.getTime()) ? null : reset.toISOString();
}

function readLength(unit: unknown, count: unknown): ZaiWindowLength | null {
  if (typeof unit !== "number" || typeof count !== "number") return null;
  const known = UNIT_BY_CODE.get(unit);
  if (!known || !Number.isInteger(count) || count <= 0) return null;
  return { unit: known, count };
}

/**
 * One window of the answer, or `null` for an entry Pages cannot show.
 * @remarks
 * An entry of an unknown type or without a used share is left out. The MCP
 * entry stands as a window of its own only when it names its own length or
 * reset; otherwise it proves no window apart from the token credits.
 */
function readWindow(entry: unknown): ReportedWindow | null {
  const fields = readAgentObject(entry);
  const measure =
    typeof fields.type === "string" ? MEASURE_BY_TYPE.get(fields.type) : null;
  if (!measure) return null;
  const usedPercent = readUsedPercent(fields);
  if (usedPercent === null) return null;
  const length = readLength(fields.unit, fields.number);
  const resetsAt = readResetsAt(fields.nextResetTime);
  if (measure === "mcp" && length === null && resetsAt === null) return null;
  return {
    measure,
    length,
    usedPercent,
    used: readCount(fields.currentValue),
    limit: readCount(fields.usage),
    remaining: readCount(fields.remaining),
    resetsAt,
  };
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

/**
 * Reads the windows and the plan of a quota answer.
 * @param payload - The parsed JSON body of the answer.
 * @returns The plan and the windows, token windows before the MCP window.
 * @throws {AgentError} `provider_auth_failed` for a rejected key,
 * `provider_bad_response` for an answer without a list of limits.
 */
export function readZaiCodingPlanUsage(payload: unknown): ZaiCodingPlanUsage {
  const envelope = readAgentObject(payload);
  const failure = envelopeFailure(envelope);
  if (failure) throw new AgentError(failure);
  const quota = readAgentObject(envelope.data);
  if (!Array.isArray(quota.limits))
    throw new AgentError("provider_bad_response");
  const taken = new Set<string>();
  const windows = quota.limits
    .map(readWindow)
    .filter((window): window is ReportedWindow => window !== null)
    .sort(
      (first, second) =>
        Number(first.measure === "mcp") - Number(second.measure === "mcp"),
    )
    .slice(0, MAX_ZAI_QUOTA_WINDOWS)
    .map((window) => ({ key: windowKey(window, taken), ...window }));
  return { plan: readPlan(quota.level), windows };
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
    return readZaiCodingPlanUsage(payload);
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
