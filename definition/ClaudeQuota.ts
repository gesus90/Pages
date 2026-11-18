import { z } from "zod";

/** The usage windows of a claude.ai subscription, in the order a card lists them. */
export const CLAUDE_QUOTA_WINDOWS = ["five_hour", "seven_day"] as const;
export type ClaudeQuotaWindowKind = (typeof CLAUDE_QUOTA_WINDOWS)[number];

/** The subscriptions a card names; any other or missing value is unknown. */
export const CLAUDE_PLANS = ["pro", "max", "ultra"] as const;
export type ClaudePlan = (typeof CLAUDE_PLANS)[number];

/** How a remaining share is coloured: from 25 % on, from 10 % on, below 10 %. */
export type ClaudeQuotaTone = "success" | "warning" | "destructive";

const WARNING_FROM = 10;
const SUCCESS_FROM = 25;

/** One window as Claude Code last reported it for a connection. */
export interface ClaudeQuotaWindow {
  readonly kind: ClaudeQuotaWindowKind;
  /** Share of the window used, 0 to 100. */
  readonly usedPercentage: number;
  /** ISO time at which Claude resets the window. */
  readonly resetsAt: string;
}

/**
 * The card of one Claude connection.
 * @remarks
 * `plan` is `null` while the subscription is not known for certain. `windows`
 * holds only the windows Claude reported whose reset is still ahead; a
 * missing window is absent, never a window with 0 %.
 */
export interface ClaudeQuotaAccount {
  readonly connectionId: string;
  readonly name: string;
  readonly plan: ClaudePlan | null;
  readonly windows: readonly ClaudeQuotaWindow[];
}

/** What one query of the quota page answers. */
export interface ClaudeQuotaSnapshot {
  readonly accounts: readonly ClaudeQuotaAccount[];
  /** Server time of the query. */
  readonly readAt: string;
}

const windowSchema = z.object({
  kind: z.enum(CLAUDE_QUOTA_WINDOWS),
  usedPercentage: z.number().min(0).max(100),
  resetsAt: z.string().min(1).max(40),
});

/** Validates a quota answer before the browser shows it. */
export const claudeQuotaSnapshotSchema = z.object({
  accounts: z
    .array(
      z.object({
        connectionId: z.string().min(1).max(200),
        name: z.string().max(400),
        plan: z.enum(CLAUDE_PLANS).nullable(),
        windows: z.array(windowSchema).max(CLAUDE_QUOTA_WINDOWS.length),
      }),
    )
    .max(500),
  readAt: z.string().min(1).max(40),
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
