import { z } from "zod";

import { quotaStatusSchema } from "@/definition/ClaudeQuota";

import type { ZaiAccountType } from "@/definition/AgentConnection";
import type { ClaudeQuotaStatus } from "@/definition/ClaudeQuota";

/**
 * The quota entries Z.AI reports for a key, in the order a card lists them.
 * @remarks
 * `tokens` is the entry `TOKENS_LIMIT` (the usage allowance of the model
 * calls, for example five hours or a week) and `mcp` the entry `TIME_LIMIT`
 * (the monthly allowance of the MCP tools). Every other entry type is
 * ignored, because nothing documents what it measures.
 */
export const ZAI_QUOTA_KINDS = ["tokens", "mcp"] as const;
export type ZaiQuotaKind = (typeof ZAI_QUOTA_KINDS)[number];

/**
 * The GLM Coding Plan tiers a card names, as `level` reports them; any other
 * or missing value is unknown.
 */
export const ZAI_PLANS = ["lite", "pro", "max"] as const;
export type ZaiPlan = (typeof ZAI_PLANS)[number];

/**
 * The units of a window length the card names.
 * @remarks
 * Z.AI documents no table of its `unit` codes. The codes below are the ones
 * its own plugin and captured answers pair with a known length: 3 with the
 * five-hour window, 5 with the one-month MCP allowance and 6 with the weekly
 * window. A window with another code has an unknown length.
 */
export const ZAI_WINDOW_UNITS = ["hours", "weeks", "months"] as const;
export type ZaiWindowUnit = (typeof ZAI_WINDOW_UNITS)[number];

const UNIT_BY_CODE: ReadonlyMap<number, ZaiWindowUnit> = new Map([
  [3, "hours"],
  [5, "months"],
  [6, "weeks"],
]);

/** The length of a window: `count` times `unit`. */
export interface ZaiWindowLength {
  readonly unit: ZaiWindowUnit;
  readonly count: number;
}

/**
 * The counts of an MCP allowance as Z.AI reports them: `used` is
 * `currentValue`, `total` is `usage` and `remaining` is `remaining`, `null`
 * when Z.AI names none.
 */
export interface ZaiQuotaCounts {
  readonly used: number;
  readonly total: number;
  readonly remaining: number | null;
}

/**
 * One quota entry of a key as Z.AI last reported it.
 * @remarks
 * `usedPercent` is the reported `percentage`, 0 to 100, and the rest is 100
 * minus it. `length` is `null` when the `unit` and `number` codes name no
 * known length; `resetsAt` is the ISO time of `nextResetTime`, `null` when
 * Z.AI named none; `counts` is set only for an `mcp` entry that reports its
 * used and total numbers.
 */
export interface ZaiQuotaWindow {
  readonly kind: ZaiQuotaKind;
  readonly usedPercent: number;
  readonly length: ZaiWindowLength | null;
  readonly resetsAt: string | null;
  readonly counts: ZaiQuotaCounts | null;
}

/**
 * What became of the entries of one answer of the usage monitor.
 * @remarks
 * `delivered` is the number of entries in `limits`. Each of them is an entry
 * of a type no card names (`unsupportedType`), an entry of a named type
 * without a usable share (`withoutUsage`) or an `evaluated` one, so
 * `delivered` is the sum of the three. Only numbers: no entry and no field of
 * it is kept here.
 */
export interface ZaiQuotaTally {
  readonly delivered: number;
  readonly unsupportedType: number;
  readonly withoutUsage: number;
  readonly evaluated: number;
}

/**
 * What one answer of the usage monitor holds: the tier, the reported entries
 * and how many entries it delivered and dropped.
 */
export interface ZaiQuotaReading {
  readonly plan: ZaiPlan | null;
  readonly windows: readonly ZaiQuotaWindow[];
  readonly tally: ZaiQuotaTally;
}

/**
 * Why a card without entries has none after an answer of Z.AI.
 * @remarks
 * `none_reported`: the answer held no entry. `unusable`: it held entries, but
 * none of a type a card names or with a usable share. `elapsed`: it held
 * usable entries, but the reset of every one has passed. The three look the
 * same on a card that only says "no entries", yet only the first says that
 * Z.AI reports no allowance for the key.
 */
export const ZAI_ABSENCES = ["none_reported", "unusable", "elapsed"] as const;
export type ZaiAbsence = (typeof ZAI_ABSENCES)[number];

/**
 * The card of one Z.AI connection.
 * @remarks
 * `accountType` is the account type saved with the connection. `plan` is
 * `null` while Z.AI names no known tier. `windows` holds only the entries Z.AI
 * reported, a missing entry is absent and never a window with 0 %. `absence`
 * says why `windows` is empty after an answer of Z.AI and is `null` otherwise.
 * The status kinds are those of the Claude card; a Z.AI card never has the
 * status `skipped`, because a running session does not keep Pages from
 * asking, and `signed_out` says that the key is missing or Z.AI rejected it.
 */
export interface ZaiQuotaAccount {
  readonly provider: "zai";
  readonly connectionId: string;
  readonly name: string;
  readonly accountType: ZaiAccountType;
  readonly plan: ZaiPlan | null;
  readonly windows: readonly ZaiQuotaWindow[];
  readonly absence: ZaiAbsence | null;
  readonly status: ClaudeQuotaStatus;
}

/**
 * The most entries a card keeps of one answer.
 * @remarks
 * Z.AI reports a handful of entries; the bound keeps a malformed answer from
 * growing the card.
 */
export const ZAI_MAX_WINDOWS = 8;

const windowSchema = z.object({
  kind: z.enum(ZAI_QUOTA_KINDS),
  usedPercent: z.number().min(0).max(100),
  length: z
    .object({
      unit: z.enum(ZAI_WINDOW_UNITS),
      count: z.number().int().positive(),
    })
    .nullable(),
  resetsAt: z.string().min(1).max(40).nullable(),
  counts: z
    .object({
      used: z.number().finite().nonnegative(),
      total: z.number().finite().nonnegative(),
      remaining: z.number().finite().nonnegative().nullable(),
    })
    .nullable(),
});

/** Validates the Z.AI card of a quota answer before the browser shows it. */
export const zaiQuotaAccountSchema = z.object({
  provider: z.literal("zai"),
  connectionId: z.string().min(1).max(200),
  name: z.string().max(400),
  accountType: z.enum(["api", "coding-plan"]),
  plan: z.enum(ZAI_PLANS).nullable(),
  windows: z.array(windowSchema).max(ZAI_MAX_WINDOWS),
  absence: z.enum(ZAI_ABSENCES).nullable(),
  status: quotaStatusSchema,
});

/**
 * Reads the tier from the `level` Z.AI reports.
 * @param reported - The reported level.
 * @returns The plan, or `null` for a missing or unlisted value.
 */
export function readZaiPlan(reported: unknown): ZaiPlan | null {
  if (typeof reported !== "string") return null;
  const level = reported.trim().toLowerCase();
  return ZAI_PLANS.find((plan) => plan === level) ?? null;
}

/**
 * Names the length of a window from its `unit` and `number` codes.
 * @param unit - The reported unit code.
 * @param count - The reported number of units.
 * @returns The length, or `null` when either code is missing or unknown.
 */
export function readZaiWindowLength(
  unit: unknown,
  count: unknown,
): ZaiWindowLength | null {
  if (typeof unit !== "number" || typeof count !== "number") return null;
  const named = UNIT_BY_CODE.get(unit);
  if (named === undefined || !Number.isInteger(count) || count <= 0)
    return null;
  return { unit: named, count };
}

const UNIT_HOURS: Readonly<Record<ZaiWindowUnit, number>> = {
  hours: 1,
  weeks: 168,
  months: 720,
};

/** Orders lengths by their size, an unknown length last. */
function lengthRank(length: ZaiWindowLength | null): number {
  if (length === null) return Number.MAX_SAFE_INTEGER;
  return length.count * UNIT_HOURS[length.unit];
}

/**
 * The entries a card shows at a moment.
 * @param windows - The reported entries of a connection.
 * @param now - The moment of display.
 * @returns The entries whose reset is not behind them, in the order of the
 * kinds and, within a kind, the shorter window first.
 * @remarks
 * An entry whose reset passed describes a period that is over, so the card
 * drops it until the next answer; an entry with no reset stays.
 */
export function visibleZaiQuotaWindows(
  windows: readonly ZaiQuotaWindow[],
  now: Date,
): ZaiQuotaWindow[] {
  return windows
    .filter(
      (window) =>
        window.resetsAt === null || Date.parse(window.resetsAt) > now.getTime(),
    )
    .sort(
      (first, second) =>
        ZAI_QUOTA_KINDS.indexOf(first.kind) -
          ZAI_QUOTA_KINDS.indexOf(second.kind) ||
        lengthRank(first.length) - lengthRank(second.length),
    );
}

/**
 * Names why an answer of Z.AI leaves a card without entries.
 * @param tally - What became of the entries of the answer, `null` when there is no answer.
 * @param shownCount - How many entries the card shows.
 * @returns The reason, or `null` when the card shows entries or has no answer.
 */
export function zaiQuotaAbsence(
  tally: ZaiQuotaTally | null,
  shownCount: number,
): ZaiAbsence | null {
  if (tally === null || shownCount > 0) return null;
  if (tally.delivered === 0) return "none_reported";
  return tally.evaluated === 0 ? "unusable" : "elapsed";
}
