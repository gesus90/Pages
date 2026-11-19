import { z } from "zod";

import { executionLocationSchema } from "@/definition/ExecutionLocation";
import { quotaPaceSchema } from "@/definition/QuotaForecast";

import type { ExecutionLocation } from "@/definition/ExecutionLocation";
import type { QuotaPace } from "@/definition/QuotaForecast";

/** The usage windows of a claude.ai subscription, in the order a card lists them. */
export const CLAUDE_QUOTA_WINDOWS = ["five_hour", "seven_day"] as const;
export type ClaudeQuotaWindowKind = (typeof CLAUDE_QUOTA_WINDOWS)[number];

/**
 * The subscriptions a card names, in the order of their tier; any other or
 * missing value is unknown.
 */
export const CLAUDE_PLANS = ["free", "pro", "max", "ultra"] as const;
export type ClaudePlan = (typeof CLAUDE_PLANS)[number];

/** How a remaining share is coloured: from 25 % on, from 10 % on, below 10 %. */
export type ClaudeQuotaTone = "success" | "warning" | "destructive";

const WARNING_FROM = 10;
const SUCCESS_FROM = 25;

/** One window as Claude Code last reported it for a connection. */
export interface ClaudeQuotaWindow {
  readonly pace?: QuotaPace;
  readonly kind: ClaudeQuotaWindowKind;
  /** Share of the window used, 0 to 100. */
  readonly usedPercentage: number;
  /** ISO time at which Claude resets the window. */
  readonly resetsAt: string;
}

/** What happened when Pages last asked Claude about a connection. */
export const CLAUDE_QUOTA_STATUS_KINDS = [
  "stored",
  "reported",
  "no_windows",
  "failed",
  "skipped",
  "signed_out",
] as const;
export type ClaudeQuotaStatusKind = (typeof CLAUDE_QUOTA_STATUS_KINDS)[number];

/**
 * The outcome of the last query of a connection, as its status line says it.
 * @remarks
 * `stored`: Pages answered from the stored figures without asking Claude;
 * `at` is the time of Claude's last answer, `null` if there never was one.
 * A page that shows it queries the card next and replaces the status with
 * that query's outcome. `reported`: Claude answered and at least one window
 * has a value; `at` is the time of that answer. `no_windows`: Claude answered without a window;
 * `at` is the time of the query. `failed`: Pages got no answer;
 * `lastSuccessAt` is the time of the last answer, `null` if there never was
 * one. `skipped`: a running session holds the sign-in exclusively, so Pages
 * did not ask; only Antigravity cards have it, because Claude and Codex are
 * asked beside a running session. `signed_out`: the connection has no
 * sign-in, so Pages cannot ask.
 */
export type ClaudeQuotaStatus =
  | { readonly kind: "stored"; readonly at: string | null }
  | { readonly kind: "reported"; readonly at: string }
  | { readonly kind: "no_windows"; readonly at: string }
  | { readonly kind: "failed"; readonly lastSuccessAt: string | null }
  | { readonly kind: "skipped" }
  | { readonly kind: "signed_out" };

/**
 * The card of one Claude connection.
 * @remarks
 * `plan` is `null` while the subscription is not known for certain. `windows`
 * holds only the windows Claude reported whose reset is still ahead; a
 * missing window is absent, never a window with 0 %. `status` tells what the
 * last query found, so "no window reported" and "query failed" never look
 * alike.
 */
export interface ClaudeQuotaAccount {
  readonly provider: "claude_code";
  readonly connectionId: string;
  /** The runner that served the card; absent when the data does not name it. */
  readonly executionLocation?: ExecutionLocation;
  readonly name: string;
  readonly plan: ClaudePlan | null;
  readonly windows: readonly ClaudeQuotaWindow[];
  readonly status: ClaudeQuotaStatus;
}

/**
 * What one query of the quota page answers.
 * @remarks
 * The answer to the query of a single card holds that card, or no account
 * when the person may not use the connection (any more).
 */
export interface ClaudeQuotaSnapshot {
  readonly accounts: readonly ClaudeQuotaAccount[];
  /**
   * Server time at which the stored figures were read. A page keeps the
   * answer with the later time when two answers cross.
   */
  readonly readAt: string;
}

const windowSchema = z.object({
  pace: quotaPaceSchema.optional(),
  kind: z.enum(CLAUDE_QUOTA_WINDOWS),
  usedPercentage: z.number().min(0).max(100),
  resetsAt: z.string().min(1).max(40),
});

const isoTimeSchema = z.string().min(1).max(40);

/** Validates the status of a card, which Claude and Antigravity cards share. */
export const quotaStatusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stored"), at: isoTimeSchema.nullable() }),
  z.object({ kind: z.literal("reported"), at: isoTimeSchema }),
  z.object({ kind: z.literal("no_windows"), at: isoTimeSchema }),
  z.object({
    kind: z.literal("failed"),
    lastSuccessAt: isoTimeSchema.nullable(),
  }),
  z.object({ kind: z.literal("skipped") }),
  z.object({ kind: z.literal("signed_out") }),
]);

/** Validates the Claude card of a quota answer before the browser shows it. */
export const claudeQuotaAccountSchema = z.object({
  provider: z.literal("claude_code"),
  connectionId: z.string().min(1).max(200),
  executionLocation: executionLocationSchema.optional(),
  name: z.string().max(400),
  plan: z.enum(CLAUDE_PLANS).nullable(),
  windows: z.array(windowSchema).max(CLAUDE_QUOTA_WINDOWS.length),
  status: quotaStatusSchema,
});

/** Narrows stored and reported window names. */
export function isClaudeQuotaWindowKind(
  value: unknown,
): value is ClaudeQuotaWindowKind {
  return CLAUDE_QUOTA_WINDOWS.some((kind) => kind === value);
}

/**
 * Reads the subscription from what Claude Code reports, such as `max` or `Claude Max`.
 * @param reported - The reported subscription type.
 * @returns The plan, or `null` for a missing, ambiguous or other plan such as `team`.
 * @remarks
 * `free` counts only when Claude names it explicitly, such as `free` or
 * `claude_free`; a missing value never reads as the free plan.
 */
export function readClaudePlan(reported: unknown): ClaudePlan | null {
  if (typeof reported !== "string") return null;
  // A usage multiple such as "20x" names a tier of the plan, not another plan.
  const words = reported
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(
      (word) => word !== "" && word !== "claude" && !/^\d+x$/u.test(word),
    );
  if (words.length !== 1) return null;
  return CLAUDE_PLANS.find((plan) => plan === words[0]) ?? null;
}

/**
 * The tier of a plan, 1 for Free to 4 for Ultra; the plan badge fills as many bars.
 * @param plan - The known plan, or `null`.
 * @returns 0 for an unknown plan.
 */
export function claudePlanTier(plan: ClaudePlan | null): number {
  return plan === null ? 0 : CLAUDE_PLANS.indexOf(plan) + 1;
}

/**
 * The used share of a window in whole percent, the figure a card shows.
 * @param usedPercentage - Reported share, 0 to 100.
 */
export function usedWholePercentage(usedPercentage: number): number {
  return Math.min(100, Math.max(0, Math.round(usedPercentage)));
}

/**
 * The remaining share of a window: 100 minus the used share, in whole percent.
 * @param usedPercentage - Reported share, 0 to 100.
 * @returns 0 for a used-up window; it is a real value, not a missing window.
 */
export function remainingWholePercentage(usedPercentage: number): number {
  return 100 - usedWholePercentage(usedPercentage);
}

/**
 * The colour of a remaining share.
 * @param remaining - Remaining share in whole percent.
 */
export function claudeQuotaTone(remaining: number): ClaudeQuotaTone {
  if (remaining >= SUCCESS_FROM) return "success";
  if (remaining >= WARNING_FROM) return "warning";
  return "destructive";
}

/**
 * The windows a card shows at a moment.
 * @param windows - The reported windows of a connection.
 * @param now - The moment of display.
 * @returns The windows whose reset is still ahead, five hours before seven days.
 * @remarks
 * Claude Code drops a window once its reset passed, so the card does too.
 */
export function visibleClaudeQuotaWindows(
  windows: readonly ClaudeQuotaWindow[],
  now: Date,
): ClaudeQuotaWindow[] {
  return windows
    .filter((window) => Date.parse(window.resetsAt) > now.getTime())
    .sort(
      (first, second) =>
        CLAUDE_QUOTA_WINDOWS.indexOf(first.kind) -
        CLAUDE_QUOTA_WINDOWS.indexOf(second.kind),
    );
}
