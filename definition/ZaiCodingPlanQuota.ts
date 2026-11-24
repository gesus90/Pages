import { z } from "zod";

import { quotaStatusSchema } from "@/definition/ClaudeQuota";
import { executionLocationSchema } from "@/definition/ExecutionLocation";
import { quotaPaceSchema } from "@/definition/QuotaForecast";

import type { ClaudeQuotaStatus } from "@/definition/ClaudeQuota";
import type { ExecutionLocation } from "@/definition/ExecutionLocation";
import type { QuotaPace } from "@/definition/QuotaForecast";

/**
 * What a window of the Coding Plan counts, after the `type` Z.AI reports:
 * `tokens` for `TOKENS_LIMIT`, `mcp` for the separate MCP tool window
 * `TIME_LIMIT`.
 */
export const ZAI_QUOTA_MEASURES = ["tokens", "mcp"] as const;
export type ZaiQuotaMeasure = (typeof ZAI_QUOTA_MEASURES)[number];

/** The units of a window length Pages can name from Z.AI's `unit` code. */
export const ZAI_WINDOW_UNITS = ["hours", "weeks", "months"] as const;
export type ZaiWindowUnit = (typeof ZAI_WINDOW_UNITS)[number];

/** The length of a window as Z.AI reported it in `unit` and `number`. */
export interface ZaiWindowLength {
  readonly unit: ZaiWindowUnit;
  readonly count: number;
}

/**
 * One window of a Coding Plan subscription as Z.AI reported it.
 * @remarks
 * `key` names the window across answers. `usedPercent` is the reported used
 * share, 0 to 100. `length` is `null` when Z.AI named no length or one Pages
 * cannot read. `used`, `limit` and `remaining` are the reported counts of the
 * window in its own measure (tokens or MCP calls), each `null` when Z.AI did
 * not report it; a reported 0 stays 0. `resetsAt` is the ISO time Z.AI named
 * for the next reset, `null` when it named none; Pages never derives one.
 */
export interface ZaiCodingPlanQuotaWindow {
  /** The measured consumption rate, attached by the server's measurement. */
  readonly pace?: QuotaPace;
  readonly key: string;
  readonly measure: ZaiQuotaMeasure;
  readonly length: ZaiWindowLength | null;
  readonly usedPercent: number;
  readonly used: number | null;
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly resetsAt: string | null;
}

/**
 * The card of one OpenCode connection that holds a Z.AI Coding Plan key.
 * @remarks
 * `plan` is the subscription level Z.AI reported, such as `pro`; `null` when
 * it reported none. `windows` holds only the windows Z.AI reported, token
 * windows before the MCP window; a missing window is absent, never a window
 * with 0 %. The status kinds are those of the Claude card; a Coding Plan card
 * never has the status `skipped`, because a running session does not keep
 * Pages from asking.
 */
export interface ZaiCodingPlanQuotaAccount {
  readonly provider: "zai_coding_plan";
  readonly connectionId: string;
  /** The runner that served the card; absent when the data does not name it. */
  readonly executionLocation?: ExecutionLocation;
  readonly name: string;
  readonly plan: string | null;
  readonly windows: readonly ZaiCodingPlanQuotaWindow[];
  readonly status: ClaudeQuotaStatus;
}

const countSchema = z.number().finite().min(0).nullable();

const windowSchema = z.object({
  pace: quotaPaceSchema.optional(),
  key: z.string().min(1).max(80),
  measure: z.enum(ZAI_QUOTA_MEASURES),
  length: z
    .object({
      unit: z.enum(ZAI_WINDOW_UNITS),
      count: z.number().int().positive(),
    })
    .nullable(),
  usedPercent: z.number().min(0).max(100),
  used: countSchema,
  limit: countSchema,
  remaining: countSchema,
  resetsAt: z.string().min(1).max(40).nullable(),
});

/** The most windows a card shows; Z.AI reports up to three. */
export const MAX_ZAI_QUOTA_WINDOWS = 6;

/** Validates the Coding Plan card of a quota answer before the browser shows it. */
export const zaiCodingPlanQuotaAccountSchema = z.object({
  provider: z.literal("zai_coding_plan"),
  connectionId: z.string().min(1).max(200),
  executionLocation: executionLocationSchema.optional(),
  name: z.string().max(400),
  plan: z.string().min(1).max(40).nullable(),
  windows: z.array(windowSchema).max(MAX_ZAI_QUOTA_WINDOWS),
  status: quotaStatusSchema,
});

const HOUR_MINUTES = 60;
const WEEK_MINUTES = 10_080;

/**
 * The length of a window in minutes, for the reset countdown and forecast.
 * @param length - The reported length.
 * @returns `null` without a length and for months, whose length varies.
 */
export function zaiWindowMinutes(
  length: ZaiWindowLength | null,
): number | null {
  if (length === null) return null;
  if (length.unit === "hours") return length.count * HOUR_MINUTES;
  if (length.unit === "weeks") return length.count * WEEK_MINUTES;
  return null;
}

/**
 * Whether a window has nothing left.
 * @param window - The window.
 */
export function isZaiWindowExhausted(
  window: ZaiCodingPlanQuotaWindow,
): boolean {
  return window.usedPercent >= 100;
}

/**
 * The windows a card shows at a moment.
 * @param windows - The reported windows of a connection.
 * @param now - The moment of display.
 * @returns The windows whose reset is not behind them, in the reported order.
 * @remarks
 * A window whose reset passed describes a period that is over, so the card
 * drops it until the next answer, as it does for Claude and Codex; a window
 * without a reset stays.
 */
export function visibleZaiQuotaWindows(
  windows: readonly ZaiCodingPlanQuotaWindow[],
  now: Date,
): ZaiCodingPlanQuotaWindow[] {
  return windows.filter(
    (window) =>
      window.resetsAt === null || Date.parse(window.resetsAt) > now.getTime(),
  );
}

/**
 * The reset the status line may name beside "Limit erreicht".
 * @param windows - The visible windows of a card.
 * @returns The reset of the used-up window when exactly one window is used
 * up; `null` otherwise or when it names no reset.
 */
export function zaiLimitResetsAt(
  windows: readonly ZaiCodingPlanQuotaWindow[],
): string | null {
  const exhausted = windows.filter(isZaiWindowExhausted);
  return exhausted.length === 1 ? exhausted[0].resetsAt : null;
}
