import {
  firstAntigravityQuotaLimit,
  visibleAntigravityQuotaGroups,
} from "@/definition/AntigravityQuota";
import { visibleClaudeQuotaWindows } from "@/definition/ClaudeQuota";
import {
  codexLimitResetsAt,
  visibleCodexQuotaWindows,
} from "@/definition/CodexQuota";

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

/** The notices a card shows in place of windows. */
export type QuotaNoticeKind = "noWindows" | "skipped" | "failed" | "signedOut";

/** What the window area of a card holds. */
export type QuotaCardBody =
  | {
      readonly kind: "windows";
      readonly windows: readonly ClaudeQuotaWindow[];
      /** After a failed query the figures stay, greyed. */
      readonly isStale: boolean;
      readonly staleSince: string | null;
    }
  | { readonly kind: "notice"; readonly notice: QuotaNoticeKind };

/** What a card shows at a moment: its status line and its window area. */
export interface QuotaCardView {
  readonly status: ClaudeQuotaStatus;
  readonly body: QuotaCardBody;
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
 * The time of the last answer Claude gave about a connection, as far as the
 * status tells it.
 * @param status - The status of the card.
 * @returns The ISO time, or `null` when the status names no answer.
 */
export function lastClaudeAnswerAt(status: ClaudeQuotaStatus): string | null {
  switch (status.kind) {
    case "stored":
    case "reported":
    case "no_windows":
      return status.at;
    case "failed":
      return status.lastSuccessAt;
    case "skipped":
    case "signed_out":
      return null;
  }
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
 * "Von Claude gemeldet" over an empty area. Stored windows stay visible while
 * a session holds the sign-in, because Claude reported them, and while a
 * query of the stored figures is on its way; after a failed query they stay
 * greyed. A connection without a sign-in shows no windows.
 */
export function quotaCardView(
  account: ClaudeQuotaAccount,
  now: Date,
): QuotaCardView {
  const windows = visibleClaudeQuotaWindows(account.windows, now);
  const status: ClaudeQuotaStatus =
    account.status.kind === "reported" && windows.length === 0
      ? { kind: "no_windows", at: account.status.at }
      : account.status;
  if (status.kind === "signed_out" || windows.length === 0)
    return {
      status,
      body: { kind: "notice", notice: NOTICE_BY_STATUS[status.kind] },
    };
  return {
    status,
    body: {
      kind: "windows",
      windows,
      isStale: status.kind === "failed",
      staleSince: status.kind === "failed" ? status.lastSuccessAt : null,
    },
  };
}

/** What the window area of a Codex card holds. */
export type CodexCardBody =
  | {
      readonly kind: "windows";
      readonly windows: readonly CodexQuotaWindow[];
      /** After a failed query the figures stay, greyed. */
      readonly isStale: boolean;
      readonly staleSince: string | null;
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
 * reads "Keine Fenster gemeldet" at the time of the answer. After a failed
 * query the windows stay greyed with the time of the last answer. The limit
 * statement of the account adds "Limit erreicht" to the status line of a
 * current answer; it never changes a window's figures, and the reset it
 * names is that of the one used-up window, if there is exactly one.
 */
export function codexCardView(
  account: CodexQuotaAccount,
  now: Date,
): CodexCardView {
  const windows = visibleCodexQuotaWindows(account.windows, now);
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
    body: {
      kind: "windows",
      windows,
      isStale: status.kind === "failed",
      staleSince: status.kind === "failed" ? status.lastSuccessAt : null,
    },
    limit:
      status.kind === "reported" && account.isLimitReached
        ? { resetsAt: codexLimitResetsAt(windows) }
        : null,
  };
}

/** What the group area of an Antigravity card holds. */
export type AntigravityCardBody =
  | {
      readonly kind: "groups";
      readonly groups: readonly AntigravityQuotaGroup[];
      /** After a failed query the figures stay, greyed. */
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
 * the time of the answer. Stored groups stay visible while a session holds
 * the sign-in and while a query is on its way; after a failed query they
 * stay greyed. A connection without a sign-in shows no groups.
 */
export function antigravityCardView(
  account: AntigravityQuotaAccount,
  now: Date,
): AntigravityCardView {
  const groups = visibleAntigravityQuotaGroups(account.groups, now);
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
    body: { kind: "groups", groups, isStale: status.kind === "failed" },
    limit:
      status.kind === "reported" ? firstAntigravityQuotaLimit(groups) : null,
  };
}
