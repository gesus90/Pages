import { z } from "zod";

import { quotaStatusSchema } from "@/definition/ClaudeQuota";
import { executionLocationSchema } from "@/definition/ExecutionLocation";
import { quotaPaceSchema } from "@/definition/QuotaForecast";

import type { ClaudeQuotaStatus } from "@/definition/ClaudeQuota";
import type { ExecutionLocation } from "@/definition/ExecutionLocation";
import type { QuotaPace } from "@/definition/QuotaForecast";

/** The windows of a quota group, in the columns a card shows them: left, right. */
export const ANTIGRAVITY_QUOTA_WINDOWS = ["five_hour", "seven_day"] as const;
export type AntigravityQuotaWindowKind =
  (typeof ANTIGRAVITY_QUOTA_WINDOWS)[number];

/** The most groups one connection stores and one card lists. */
export const ANTIGRAVITY_QUOTA_GROUP_LIMIT = 50;

/**
 * One window of a quota group as Antigravity reported it.
 * @remarks
 * `remainingFraction` is the reported rest, 0 to 1, never derived from a used
 * share. `resetsAt` is the ISO time at which the window resets, `null` when
 * Antigravity named none.
 */
export interface AntigravityQuotaWindow {
  readonly pace?: QuotaPace;
  readonly kind: AntigravityQuotaWindowKind;
  readonly remainingFraction: number;
  readonly resetsAt: string | null;
}

/**
 * A group of models that share their quota, such as the Gemini models.
 * @remarks
 * `windows` holds only the windows Antigravity reported for the group; a
 * missing window is absent, never a window with 0 %. A single-model quota that
 * Antigravity reports as a group of its own is a group like any other.
 */
export interface AntigravityQuotaGroup {
  readonly name: string;
  readonly windows: readonly AntigravityQuotaWindow[];
}

/**
 * The card of one Antigravity connection.
 * @remarks
 * `groups` are all reported groups in the order of the source. The status
 * kinds are those of the Claude card: `reported` when at least one window has
 * a value, `no_windows` when Antigravity answered without quota data, and
 * `failed`, `skipped` and `signed_out` as the query ended otherwise. The
 * answer names no subscription, so the card shows none.
 */
export interface AntigravityQuotaAccount {
  readonly provider: "antigravity";
  readonly connectionId: string;
  /** The runner that served the card; absent when the data does not name it. */
  readonly executionLocation?: ExecutionLocation;
  readonly name: string;
  readonly groups: readonly AntigravityQuotaGroup[];
  readonly status: ClaudeQuotaStatus;
}

const windowSchema = z.object({
  pace: quotaPaceSchema.optional(),
  kind: z.enum(ANTIGRAVITY_QUOTA_WINDOWS),
  remainingFraction: z.number().min(0).max(1),
  resetsAt: z.string().min(1).max(40).nullable(),
});

/** Validates the Antigravity card of a quota answer before the browser shows it. */
export const antigravityQuotaAccountSchema = z.object({
  provider: z.literal("antigravity"),
  connectionId: z.string().min(1).max(200),
  executionLocation: executionLocationSchema.optional(),
  name: z.string().max(400),
  groups: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        windows: z.array(windowSchema).max(ANTIGRAVITY_QUOTA_WINDOWS.length),
      }),
    )
    .max(ANTIGRAVITY_QUOTA_GROUP_LIMIT),
  status: quotaStatusSchema,
});

/** The family of a group, which decides the colour of its dot. */
export type AntigravityGroupFamily = "gemini" | "claude_gpt" | "other";

/**
 * Tells which known family a group belongs to.
 * @param name - The group name as Antigravity reports it.
 * @returns `gemini` for the Gemini models and `claude_gpt` for the Claude and
 * GPT models; every other group, such as one model with a quota of its own,
 * is `other`.
 */
export function antigravityGroupFamily(name: string): AntigravityGroupFamily {
  const text = name
    .trim()
    .toLowerCase()
    .replace(/\s+models?$/u, "");
  if (text === "gemini") return "gemini";
  if (/^claude\s*(?:and|und|&|\/|,)?\s*gpt$/u.test(text)) return "claude_gpt";
  return "other";
}

/**
 * The remaining share of a window in whole percent, the figure a card shows.
 * @param remainingFraction - The reported rest, 0 to 1.
 * @returns 0 only for a window with nothing left: a rest above 0 never reads
 * as "0 %", so the figure and the limit state agree.
 */
export function remainingQuotaPercentage(remainingFraction: number): number {
  if (remainingFraction <= 0) return 0;
  return Math.min(100, Math.max(1, Math.round(remainingFraction * 100)));
}

/**
 * Whether a window has nothing left.
 * @param window - The window.
 */
export function isAntigravityWindowExhausted(
  window: AntigravityQuotaWindow,
): boolean {
  return window.remainingFraction <= 0;
}

/**
 * The groups a card shows at a moment.
 * @param groups - The reported groups of a connection.
 * @param now - The moment of display.
 * @returns The groups in the order of the source, each with the windows whose
 * reset is still ahead; a group without such a window leaves the card.
 * @remarks
 * Antigravity drops a window once its reset passed, so the card does too.
 */
export function visibleAntigravityQuotaGroups(
  groups: readonly AntigravityQuotaGroup[],
  now: Date,
): AntigravityQuotaGroup[] {
  return groups
    .map((group) => ({
      name: group.name,
      windows: group.windows.filter(
        (window) =>
          window.resetsAt === null ||
          Date.parse(window.resetsAt) > now.getTime(),
      ),
    }))
    .filter((group) => group.windows.length > 0);
}

/** The first window that has nothing left, with the group it belongs to. */
export interface AntigravityQuotaLimit {
  readonly groupName: string;
  readonly window: AntigravityQuotaWindow;
}

/**
 * Finds the first exhausted window in the order of the source.
 * @param groups - The visible groups of a card.
 * @returns The group and window, or `null` when no window is exhausted.
 * @remarks
 * The search covers every group, also those a scrolled list does not show, so
 * the status line can name a limit that lies out of sight.
 */
export function firstAntigravityQuotaLimit(
  groups: readonly AntigravityQuotaGroup[],
): AntigravityQuotaLimit | null {
  for (const group of groups) {
    const window = group.windows.find(isAntigravityWindowExhausted);
    if (window) return { groupName: group.name, window };
  }
  return null;
}
