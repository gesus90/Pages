import { visibleClaudeQuotaWindows } from "@/definition/ClaudeQuota";

import type {
  ClaudeQuotaAccount,
  ClaudeQuotaStatus,
  ClaudeQuotaWindow,
} from "@/definition/ClaudeQuota";

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
 * a session holds the sign-in, because Claude reported them; after a failed
 * query they stay greyed. A connection without a sign-in shows no windows.
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
