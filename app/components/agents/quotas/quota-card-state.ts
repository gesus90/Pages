import {
  firstAntigravityQuotaLimit,
  visibleAntigravityQuotaGroups,
} from "@/definition/AntigravityQuota";
import { visibleClaudeQuotaWindows } from "@/definition/ClaudeQuota";
import {
  codexLimitResetsAt,
  isCodexWindowExhausted,
  visibleCodexQuotaWindows,
} from "@/definition/CodexQuota";
import {
  isZaiWindowExhausted,
  visibleZaiQuotaWindows,
  zaiLimitResetsAt,
} from "@/definition/ZaiCodingPlanQuota";

import type {
  AntigravityQuotaAccount,
  AntigravityQuotaGroup,
  AntigravityQuotaLimit,
} from "@/definition/AntigravityQuota";
import type {
  ClaudeQuotaAccount,
  ClaudeQuotaStatus,
  ClaudeQuotaWindow,
} from "@/definition/ClaudeQuota";

import type {
  CodexQuotaAccount,
  CodexQuotaWindow,
} from "@/definition/CodexQuota";
import type {
  ZaiCodingPlanQuotaAccount,
  ZaiCodingPlanQuotaWindow,
} from "@/definition/ZaiCodingPlanQuota";

/** The notices a card shows in place of windows. */
export type QuotaNoticeKind = "noWindows" | "skipped" | "failed" | "signedOut";

/** What the window area of a card holds. */
export type QuotaCardBody =
  | {
      readonly kind: "windows";
      readonly windows: readonly ClaudeQuotaWindow[];
      readonly isStale: boolean;
    }
  | { readonly kind: "notice"; readonly notice: QuotaNoticeKind };

interface QuotaLimit {
  readonly resetsAt: string | null;
}

function quotaLimit(
  status: ClaudeQuotaStatus,
  windows: readonly QuotaLimit[],
): QuotaLimit | null {
  if (status.kind !== "reported" && status.kind !== "stored") return null;
  if (windows.length === 0) return null;
  return { resetsAt: windows.length === 1 ? windows[0].resetsAt : null };
}

/** What a card shows at a moment: its status line and its window area. */
export interface QuotaCardView {
  readonly status: ClaudeQuotaStatus;
  readonly body: QuotaCardBody;
  readonly limit: QuotaLimit | null;
}

/** The notice of a status without windows to show. */
const NOTICE_BY_STATUS: Readonly<
  Record<ClaudeQuotaStatus["kind"], QuotaNoticeKind>
> = {
  stored: "noWindows",
  reported: "noWindows",
  no_windows: "noWindows",
  failed: "failed",
  skipped: "skipped",
  signed_out: "signedOut",
};

/**
 * The time of the last successful provider answer.
 * @param status - The status of the card.
 * @returns The ISO time, or `null` when the status names no answer.
 */
export function lastQuotaAnswerAt(status: ClaudeQuotaStatus): string | null {
  switch (status.kind) {
    case "stored":
    case "reported":
    case "no_windows":
      return status.at;
    case "failed":
    case "skipped":
      return status.lastSuccessAt;
    case "signed_out":
      return null;
  }
}

function isStaleReading(status: ClaudeQuotaStatus): boolean {
  return status.kind === "failed" || status.kind === "skipped";
}

/**
 * What a card shows at a moment.
 * @param account - The card as the server answered it.
 * @param now - The moment of display.
 * @returns The status line and the window area.
 * @remarks
 * A window leaves the card once its reset passed. When the last window of a
 * reported card leaves, Claude has no window to report any more, so the card
 * reads "Keine Fenster gemeldet" at the time of the answer instead of
 * "Von Claude gemeldet" over an empty area. A missed query keeps the windows
 * from the last measurement, including those that have since elapsed.
 */
export function quotaCardView(
  account: ClaudeQuotaAccount,
  now: Date,
): QuotaCardView {
  const isStale = isStaleReading(account.status);
  const windows = isStale
    ? account.windows
    : visibleClaudeQuotaWindows(account.windows, now);
  const status: ClaudeQuotaStatus =
    account.status.kind === "reported" && windows.length === 0
      ? { kind: "no_windows", at: account.status.at }
      : account.status;
  if (status.kind === "signed_out" || windows.length === 0)
    return {
      status,
      body: { kind: "notice", notice: NOTICE_BY_STATUS[status.kind] },
      limit: null,
    };
  return {
    status,
    body: { kind: "windows", windows, isStale },
    limit: quotaLimit(
      status,
      windows.filter((window) => window.usedPercentage >= 100),
    ),
  };
}

/** What the window area of a Codex card holds. */
export type CodexCardBody =
  | {
      readonly kind: "windows";
      readonly windows: readonly CodexQuotaWindow[];
      readonly isStale: boolean;
    }
  | { readonly kind: "notice"; readonly notice: QuotaNoticeKind };

/** The limit a current Codex answer states for the account. */
export interface CodexCardLimit {
  /**
   * ISO time at which the limit ends; `null` unless exactly one window is
   * used up and names its reset.
   */
  readonly resetsAt: string | null;
}

/** What a Codex card shows at a moment. */
export interface CodexCardView {
  readonly status: ClaudeQuotaStatus;
  readonly body: CodexCardBody;
  /** `null` unless the answer is current and states that the limit is reached. */
  readonly limit: CodexCardLimit | null;
}

/**
 * What a Codex card shows at a moment.
 * @param account - The card as the server answered it.
 * @param now - The moment of display.
 * @returns The status line, the window area and the limit the status line names.
 * @remarks
 * A window leaves the card once its reset passed. When the last window of a
 * reported card leaves, Codex has no window to report any more, so the card
 * reads "Keine Fenster gemeldet" at the time of the answer. A missed query
 * keeps the windows from the last measurement. The limit
 * statement of the account adds "Limit erreicht" to the status line of a
 * current answer; it never changes a window's figures, and the reset it
 * names is that of the one used-up window, if there is exactly one.
 */
export function codexCardView(
  account: CodexQuotaAccount,
  now: Date,
): CodexCardView {
  const isStale = isStaleReading(account.status);
  const windows = isStale
    ? account.windows
    : visibleCodexQuotaWindows(account.windows, now);
  const status: ClaudeQuotaStatus =
    account.status.kind === "reported" && windows.length === 0
      ? { kind: "no_windows", at: account.status.at }
      : account.status;
  if (status.kind === "signed_out" || windows.length === 0)
    return {
      status,
      body: { kind: "notice", notice: NOTICE_BY_STATUS[status.kind] },
      limit: null,
    };
  return {
    status,
    body: { kind: "windows", windows, isStale },
    limit:
      (status.kind === "reported" || status.kind === "stored") &&
      (account.isLimitReached || windows.some(isCodexWindowExhausted))
        ? { resetsAt: codexLimitResetsAt(windows) }
        : null,
  };
}

/** What the group area of an Antigravity card holds. */
export type AntigravityCardBody =
  | {
      readonly kind: "groups";
      readonly groups: readonly AntigravityQuotaGroup[];
      readonly isStale: boolean;
    }
  | { readonly kind: "notice"; readonly notice: QuotaNoticeKind };

/** What an Antigravity card shows at a moment. */
export interface AntigravityCardView {
  readonly status: ClaudeQuotaStatus;
  readonly body: AntigravityCardBody;
  /**
   * The first window without a rest in any group, also one a scrolled list
   * does not show; the status line names it. `null` unless the answer is
   * current.
   */
  readonly limit: AntigravityQuotaLimit | null;
}

/**
 * What an Antigravity card shows at a moment.
 * @param account - The card as the server answered it.
 * @param now - The moment of display.
 * @returns The status line, the group area and the limit the status line names.
 * @remarks
 * A window leaves the card once its reset passed, and a group once its last
 * window left. When the last group of a reported card leaves, Antigravity has
 * nothing to report any more, so the card reads "Keine Fenster gemeldet" at
 * the time of the answer. A skipped or failed query keeps the groups from
 * the last measurement.
 */
export function antigravityCardView(
  account: AntigravityQuotaAccount,
  now: Date,
): AntigravityCardView {
  const isStale = isStaleReading(account.status);
  const groups = isStale
    ? account.groups
    : visibleAntigravityQuotaGroups(account.groups, now);
  const status: ClaudeQuotaStatus =
    account.status.kind === "reported" && groups.length === 0
      ? { kind: "no_windows", at: account.status.at }
      : account.status;
  if (status.kind === "signed_out" || groups.length === 0)
    return {
      status,
      body: { kind: "notice", notice: NOTICE_BY_STATUS[status.kind] },
      limit: null,
    };
  return {
    status,
    body: { kind: "groups", groups, isStale },
    limit:
      status.kind === "reported" || status.kind === "stored"
        ? firstAntigravityQuotaLimit(groups)
        : null,
  };
}

/**
 * Why a Z.AI Coding Plan card that queried successfully shows no window:
 * every reported window has passed its reset since the answer, or Z.AI
 * reported entries Pages cannot read as a window. Without a reason the
 * answer held no entry at all.
 */
export type ZaiNoticeReason = "expired" | "unsupported";

/** What the window area of a Z.AI Coding Plan card holds. */
export type ZaiCodingPlanCardBody =
  | {
      readonly kind: "windows";
      readonly windows: readonly ZaiCodingPlanQuotaWindow[];
      readonly isStale: boolean;
    }
  | {
      readonly kind: "notice";
      readonly notice: QuotaNoticeKind;
      readonly reason: ZaiNoticeReason | null;
    };

/** Why a successful query left the card without a window, after its answer. */
function zaiNoticeReason(
  account: ZaiCodingPlanQuotaAccount,
  notice: QuotaNoticeKind,
): ZaiNoticeReason | null {
  if (notice !== "noWindows") return null;
  if (account.windows.length > 0) return "expired";
  return account.unreadableCount > 0 ? "unsupported" : null;
}

/** What a Z.AI Coding Plan card shows at a moment. */
export interface ZaiCodingPlanCardView {
  readonly status: ClaudeQuotaStatus;
  readonly body: ZaiCodingPlanCardBody;
  /** `null` unless the answer is current and a window is used up. */
  readonly limit: CodexCardLimit | null;
}

/**
 * What a Z.AI Coding Plan card shows at a moment.
 * @param account - The card as the server answered it.
 * @param now - The moment of display.
 * @returns The status line, the window area and the limit the status line names.
 * @remarks
 * It follows the Codex card: a window leaves once its reset passed after the
 * answer, a reported card without a window left reads "Keine Fenster
 * gemeldet", and a missed query keeps the windows of the last answer, marked
 * with its time. The notice of a successful query tells an empty answer,
 * windows that have expired and entries Pages cannot read apart. A used-up
 * window adds "Limit erreicht" to the line of a current answer, with the
 * reset of that window when exactly one is used up.
 */
export function zaiCodingPlanCardView(
  account: ZaiCodingPlanQuotaAccount,
  now: Date,
): ZaiCodingPlanCardView {
  const isStale = isStaleReading(account.status);
  const windows = isStale
    ? account.windows
    : visibleZaiQuotaWindows(account.windows, {
        now,
        answeredAt: lastQuotaAnswerAt(account.status),
      });
  const status: ClaudeQuotaStatus =
    account.status.kind === "reported" && windows.length === 0
      ? { kind: "no_windows", at: account.status.at }
      : account.status;
  if (status.kind === "signed_out" || windows.length === 0) {
    const notice = NOTICE_BY_STATUS[status.kind];
    return {
      status,
      body: {
        kind: "notice",
        notice,
        reason: zaiNoticeReason(account, notice),
      },
      limit: null,
    };
  }
  return {
    status,
    body: { kind: "windows", windows, isStale },
    limit:
      (status.kind === "reported" || status.kind === "stored") &&
      windows.some(isZaiWindowExhausted)
        ? { resetsAt: zaiLimitResetsAt(windows) }
        : null,
  };
}
