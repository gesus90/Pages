import { z } from "zod";

import { quotaStatusSchema } from "@/definition/ClaudeQuota";
import { quotaPaceSchema } from "@/definition/QuotaForecast";

import type { ClaudeQuotaStatus } from "@/definition/ClaudeQuota";
import type { QuotaPace } from "@/definition/QuotaForecast";

/** The windows of the general Codex quota in the order a card lists them. */
export const CODEX_QUOTA_WINDOWS = ["primary", "secondary"] as const;
export type CodexQuotaWindowKind = (typeof CODEX_QUOTA_WINDOWS)[number];

/**
 * The ChatGPT subscriptions a card names, as the app server reports them in
 * `planType`; any other, missing or `unknown` value is unknown.
 */
export const CODEX_PLANS = [
  "free",
  "go",
  "plus",
  "pro",
  "prolite",
  "promax",
  "team",
  "business",
  "enterprise",
  "edu",
] as const;
export type CodexPlan = (typeof CODEX_PLANS)[number];

/**
 * The reported plan types that name one of the known subscriptions.
 * @remarks
 * Business, enterprise and education plans are reported with several
 * variants of one subscription; every other value, such as `unknown`, names
 * no subscription for certain.
 */
const PLAN_BY_REPORTED_TYPE: ReadonlyMap<string, CodexPlan> = new Map([
  ["free", "free"],
  ["go", "go"],
  ["plus", "plus"],
  ["pro", "pro"],
  ["prolite", "prolite"],
  ["promax", "promax"],
  ["team", "team"],
  ["business", "business"],
  ["self_serve_business_prolite", "business"],
  ["self_serve_business_usage_based", "business"],
  ["enterprise", "enterprise"],
  ["enterprise_cbp_automation", "enterprise"],
  ["enterprise_cbp_usage_based", "enterprise"],
  ["edu", "edu"],
  ["edu_plus", "edu"],
  ["edu_pro", "edu"],
]);

/**
 * One window of the general Codex quota as the app server reported it.
 * @remarks
 * `usedPercent` is the reported used share in whole percent, 0 to 100; the
 * rest is 100 minus it. `durationMinutes` is the reported length of the
 * window, `null` when the server named none; `resetsAt` is the ISO time at
 * which it resets, `null` when none was named.
 */
export interface CodexQuotaWindow {
  readonly pace?: QuotaPace;
  readonly kind: CodexQuotaWindowKind;
  readonly usedPercent: number;
  readonly durationMinutes: number | null;
  readonly resetsAt: string | null;
}

/**
 * The card of one Codex connection.
 * @remarks
 * `plan` is `null` while the subscription is not reported or not known.
 * `windows` holds only the windows the app server reported, `primary` before
 * `secondary`; a missing window is absent, never a window with 0 %.
 * `isLimitReached` is the account's own statement that its limit is reached;
 * it never changes the figures of the windows. The status kinds are those of
 * the Claude card; a Codex card never has the status `skipped`, because a
 * running session does not keep Pages from asking.
 */
export interface CodexQuotaAccount {
  readonly provider: "codex_cli";
  readonly connectionId: string;
  readonly name: string;
  readonly plan: CodexPlan | null;
  readonly windows: readonly CodexQuotaWindow[];
  readonly isLimitReached: boolean;
  readonly status: ClaudeQuotaStatus;
}

const windowSchema = z.object({
  pace: quotaPaceSchema.optional(),
  kind: z.enum(CODEX_QUOTA_WINDOWS),
  usedPercent: z.number().min(0).max(100),
  durationMinutes: z.number().int().positive().nullable(),
  resetsAt: z.string().min(1).max(40).nullable(),
});

/** Validates the Codex card of a quota answer before the browser shows it. */
export const codexQuotaAccountSchema = z.object({
  provider: z.literal("codex_cli"),
  connectionId: z.string().min(1).max(200),
  name: z.string().max(400),
  plan: z.enum(CODEX_PLANS).nullable(),
  windows: z.array(windowSchema).max(CODEX_QUOTA_WINDOWS.length),
  isLimitReached: z.boolean(),
  status: quotaStatusSchema,
});

/** Narrows stored and reported window names. */
export function isCodexQuotaWindowKind(
  value: unknown,
): value is CodexQuotaWindowKind {
  return CODEX_QUOTA_WINDOWS.some((kind) => kind === value);
}

/**
 * Reads the subscription from the `planType` the app server reports.
 * @param reported - The reported plan type.
 * @returns The plan, or `null` for a missing, `unknown` or unlisted value.
 * @remarks
 * `free` counts only when the server names it explicitly; a missing value
 * never reads as the free plan.
 */
export function readCodexPlan(reported: unknown): CodexPlan | null {
  if (typeof reported !== "string") return null;
  return PLAN_BY_REPORTED_TYPE.get(reported.trim().toLowerCase()) ?? null;
}

/**
 * The remaining share of a window: 100 minus the used share, in whole percent.
 * @param usedPercent - Reported share, 0 to 100.
 * @returns 0 only for a window whose used share reached 100.
 */
export function remainingCodexPercentage(usedPercent: number): number {
  return 100 - Math.min(100, Math.max(0, Math.round(usedPercent)));
}

/**
 * Whether a window has nothing left.
 * @param window - The window.
 */
export function isCodexWindowExhausted(window: CodexQuotaWindow): boolean {
  return remainingCodexPercentage(window.usedPercent) === 0;
}

/**
 * The windows a card shows at a moment.
 * @param windows - The reported windows of a connection.
 * @param now - The moment of display.
 * @returns The windows whose reset is not behind them, `primary` before `secondary`.
 * @remarks
 * A window whose reset passed describes a period that is over, so the card
 * drops it until the next answer, as it does for Claude; a window with no
 * reset stays.
 */
export function visibleCodexQuotaWindows(
  windows: readonly CodexQuotaWindow[],
  now: Date,
): CodexQuotaWindow[] {
  return windows
    .filter(
      (window) =>
        window.resetsAt === null || Date.parse(window.resetsAt) > now.getTime(),
    )
    .sort(
      (first, second) =>
        CODEX_QUOTA_WINDOWS.indexOf(first.kind) -
        CODEX_QUOTA_WINDOWS.indexOf(second.kind),
    );
}

/**
 * The reset the status line may name beside "Limit erreicht".
 * @param windows - The visible windows of a card.
 * @returns The reset of the window without a rest when exactly one window is
 * used up and it names a reset; `null` otherwise.
 * @remarks
 * With no used-up window the limit belongs to no window, and with several
 * the reset that ends the limit is not known, so the line names none.
 */
export function codexLimitResetsAt(
  windows: readonly CodexQuotaWindow[],
): string | null {
  const exhausted = windows.filter(isCodexWindowExhausted);
  return exhausted.length === 1 ? exhausted[0].resetsAt : null;
}

/** The length of a window as a card names it. */
export type CodexWindowLength =
  | { readonly kind: "five_hour" }
  | { readonly kind: "seven_day" }
  | {
      readonly kind: "days" | "hours" | "minutes";
      readonly count: number;
    }
  | { readonly kind: "unknown" };

const FIVE_HOURS_MINUTES = 300;
const SEVEN_DAYS_MINUTES = 10_080;
const HOUR_MINUTES = 60;
const DAY_MINUTES = 1_440;

/**
 * Names the length of a window from `windowDurationMins`.
 * @param durationMinutes - The reported length in minutes, `null` when none.
 * @returns `five_hour` for 300 and `seven_day` for 10080 minutes; otherwise
 * whole days, whole hours or minutes, and `unknown` without a length.
 */
export function codexWindowLength(
  durationMinutes: number | null,
): CodexWindowLength {
  if (durationMinutes === null || durationMinutes <= 0)
    return { kind: "unknown" };
  if (durationMinutes === FIVE_HOURS_MINUTES) return { kind: "five_hour" };
  if (durationMinutes === SEVEN_DAYS_MINUTES) return { kind: "seven_day" };
  if (durationMinutes % DAY_MINUTES === 0)
    return { kind: "days", count: durationMinutes / DAY_MINUTES };
  if (durationMinutes % HOUR_MINUTES === 0)
    return { kind: "hours", count: durationMinutes / HOUR_MINUTES };
  return { kind: "minutes", count: durationMinutes };
}
