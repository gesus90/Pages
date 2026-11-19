import { readAgentObject } from "@/backend/agents/AgentPayload";
import {
  ZAI_MAX_WINDOWS,
  readZaiPlan,
  readZaiWindowLength,
} from "@/definition/ZaiQuota";

import type {
  ZaiQuotaCounts,
  ZaiQuotaKind,
  ZaiQuotaReading,
  ZaiQuotaWindow,
} from "@/definition/ZaiQuota";

/** The entry types of the usage monitor that a card names; any other type is ignored. */
const KIND_BY_TYPE: ReadonlyMap<string, ZaiQuotaKind> = new Map([
  ["TOKENS_LIMIT", "tokens"],
  ["TIME_LIMIT", "mcp"],
]);

function readAmount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** `nextResetTime` is a Unix time in milliseconds; zero, negative and malformed values name no reset. */
function readResetTime(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return null;
  const resetsAt = new Date(value);
  return Number.isNaN(resetsAt.getTime()) ? null : resetsAt.toISOString();
}

/** The plugin of Z.AI reads `currentValue` as the used and `usage` as the total number of calls. */
function readCounts(entry: Record<string, unknown>): ZaiQuotaCounts | null {
  const used = readAmount(entry.currentValue);
  const total = readAmount(entry.usage);
  if (used === null || total === null) return null;
  return { used, total, remaining: readAmount(entry.remaining) };
}

/** The reported share; without one the counts give it, and without either the entry says nothing. */
function readUsedPercent(
  entry: Record<string, unknown>,
  counts: ZaiQuotaCounts | null,
): number | null {
  const reported = readAmount(entry.percentage);
  if (reported !== null) return Math.min(100, reported);
  if (counts === null || counts.total === 0) return null;
  return Math.min(100, (counts.used / counts.total) * 100);
}

function readWindow(entry: unknown): ZaiQuotaWindow | null {
  const fields = readAgentObject(entry);
  const kind =
    typeof fields.type === "string" ? KIND_BY_TYPE.get(fields.type) : undefined;
  if (kind === undefined) return null;
  const counts = kind === "mcp" ? readCounts(fields) : null;
  const usedPercent = readUsedPercent(fields, counts);
  if (usedPercent === null) return null;
  return {
    kind,
    usedPercent,
    length: readZaiWindowLength(fields.unit, fields.number),
    resetsAt: readResetTime(fields.nextResetTime),
    counts,
  };
}

/**
 * Reads the answer of the usage monitor of Z.AI.
 * @param payload - The parsed JSON body of `GET /api/monitor/usage/quota/limit`.
 * @returns The tier and the entries it reports, or `null` when the body is no
 * successful answer of the monitor.
 * @remarks
 * The body is `{ code, msg, success, data: { limits, level } }`. An answer
 * with `success: false` or another `code` than 200 is a failure. A successful
 * answer without any entry is valid: it says the key has no allowance to
 * report. Entries of an unknown type and entries without a usable share are
 * dropped, so the card never shows a value Z.AI did not report.
 */
export function readZaiQuota(payload: unknown): ZaiQuotaReading | null {
  const envelope = readAgentObject(payload);
  if (envelope.success === false) return null;
  if (typeof envelope.code === "number" && envelope.code !== 200) return null;
  if (typeof envelope.data !== "object" || envelope.data === null) return null;
  const quota = readAgentObject(envelope.data);
  const limits: unknown[] = Array.isArray(quota.limits) ? quota.limits : [];
  const windows = limits
    .map(readWindow)
    .filter((window): window is ZaiQuotaWindow => window !== null)
    .slice(0, ZAI_MAX_WINDOWS);
  return { plan: readZaiPlan(quota.level), windows };
}
