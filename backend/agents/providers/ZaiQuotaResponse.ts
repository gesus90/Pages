import { readAgentObject } from "@/backend/agents/AgentPayload";
import {
  ZAI_MAX_WINDOWS,
  readZaiPlan,
  readZaiWindowLength,
} from "@/definition/ZaiQuota";

import type {
  ZaiQuotaCounts,
  ZaiQuotaEntrySummary,
  ZaiQuotaKind,
  ZaiQuotaReading,
  ZaiQuotaTally,
  ZaiQuotaWindow,
} from "@/definition/ZaiQuota";

/** Why an entry of the answer leaves no entry on the card. */
type DroppedEntry = "unsupportedType" | "withoutUsage";

interface EvaluatedEntry {
  readonly window: ZaiQuotaWindow | DroppedEntry;
  readonly summary: ZaiQuotaEntrySummary;
}

const TYPE_TOKEN_PATTERN = /^[A-Za-z0-9_]{1,40}$/;

/** The entry types of the usage monitor that a card names; any other type is ignored. */
const KIND_BY_TYPE: ReadonlyMap<string, ZaiQuotaKind> = new Map([
  ["TOKENS_LIMIT", "tokens"],
  ["CREDIT_LIMIT", "credits"],
  ["TIME_LIMIT", "mcp"],
]);

function readTypeToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return TYPE_TOKEN_PATTERN.test(trimmed) ? trimmed : "invalid";
}

function readInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

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

/** The monitor reports `currentValue` as the used and `usage` as the total count. */
function readCounts(entry: Record<string, unknown>): ZaiQuotaCounts | null {
  const used = readAmount(entry.currentValue);
  const total = readAmount(entry.usage);
  if (used === null || total === null || total === 0) return null;
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

function readEntry(entry: unknown): EvaluatedEntry {
  const fields = readAgentObject(entry);
  const type = readTypeToken(fields.type);
  const kind = type !== null ? (KIND_BY_TYPE.get(type) ?? null) : null;
  const length = readZaiWindowLength(fields.unit, fields.number);
  const resetsAt = readResetTime(fields.nextResetTime);
  const rawCounts = readCounts(fields);
  const counts = kind === "tokens" ? null : rawCounts;
  const usedPercent = readUsedPercent(fields, rawCounts);
  const baseSummary = {
    type,
    kind,
    unit: readInteger(fields.unit),
    number: readInteger(fields.number),
    length,
    percentage: readAmount(fields.percentage),
    currentValue: readAmount(fields.currentValue),
    usage: readAmount(fields.usage),
    remaining: readAmount(fields.remaining),
    resetsAt,
  };
  if (kind === null)
    return {
      window: "unsupportedType",
      summary: { ...baseSummary, outcome: "unsupportedType" },
    };
  if (usedPercent === null)
    return {
      window: "withoutUsage",
      summary: { ...baseSummary, outcome: "withoutUsage" },
    };
  return {
    window: { kind, usedPercent, length, resetsAt, counts },
    summary: { ...baseSummary, outcome: "evaluated" },
  };
}

function isWindow(
  reading: ZaiQuotaWindow | DroppedEntry,
): reading is ZaiQuotaWindow {
  return typeof reading !== "string";
}

/** A missing list is an answer without entries; a list of another shape is no answer of the monitor. */
function readLimits(value: unknown): unknown[] | null {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : null;
}

function countDropped(
  readings: readonly (ZaiQuotaWindow | DroppedEntry)[],
  reason: DroppedEntry,
): number {
  return readings.filter((entry) => entry === reason).length;
}

function tallyEntries(
  readings: readonly (ZaiQuotaWindow | DroppedEntry)[],
): ZaiQuotaTally {
  return {
    delivered: readings.length,
    unsupportedType: countDropped(readings, "unsupportedType"),
    withoutUsage: countDropped(readings, "withoutUsage"),
    evaluated: readings.filter(isWindow).length,
  };
}

/**
 * Reads the answer of the usage monitor of Z.AI.
 * @param payload - The parsed JSON body of `GET /api/monitor/usage/quota/limit`.
 * @returns The tier, the entries it reports and how many entries it delivered
 * and dropped, or `null` when the body is no successful answer of the monitor.
 * @remarks
 * The body is `{ code, msg, success, data: { limits, level } }`. An answer
 * with `success: false` or another `code` than 200 is a failure, and so is a
 * `limits` that is no list. A successful answer without any entry is valid: it
 * says the key has no allowance to report. Entries of an unknown type and
 * entries without a usable share are dropped, so the card never shows a value
 * Z.AI did not report; the tally names how many were dropped for which reason,
 * so an empty card can tell an empty answer from dropped entries.
 */
export function readZaiQuota(payload: unknown): ZaiQuotaReading | null {
  const envelope = readAgentObject(payload);
  if (envelope.success === false) return null;
  if (typeof envelope.code === "number" && envelope.code !== 200) return null;
  if (typeof envelope.data !== "object" || envelope.data === null) return null;
  const quota = readAgentObject(envelope.data);
  const limits = readLimits(quota.limits);
  if (limits === null) return null;
  const evaluated = limits.map(readEntry);
  const readings = evaluated.map((entry) => entry.window);
  return {
    plan: readZaiPlan(quota.level),
    windows: readings.filter(isWindow).slice(0, ZAI_MAX_WINDOWS),
    tally: tallyEntries(readings),
    entries: evaluated.map((entry) => entry.summary).slice(0, ZAI_MAX_WINDOWS),
  };
}
