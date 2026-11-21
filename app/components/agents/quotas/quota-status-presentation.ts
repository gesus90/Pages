import {
  CircleCheck,
  CirclePause,
  Clock,
  Info,
  TriangleAlert,
} from "lucide-react";

import type { TFunction } from "i18next";
import type { LucideIcon } from "lucide-react";
import type { QuotaAccount } from "@/definition/AgentQuota";
import type { AntigravityQuotaWindowKind } from "@/definition/AntigravityQuota";
import type { ClaudeQuotaStatus } from "@/definition/ClaudeQuota";

/** The colour of a status line; static, so Tailwind finds the classes. */
export type StatusTone = "success" | "muted" | "warning" | "destructive";

/** What the line offers on its right: nothing, a new query or the settings. */
export type StatusAction = "none" | "retry" | "openConnection";

/** The word, symbol, colour and action of a status line. */
export interface StatusPresentation {
  /** The symbol, or `spinner` for the turning ring. */
  readonly icon: LucideIcon | "spinner";
  readonly tone: StatusTone;
  readonly text: string;
  readonly action: StatusAction;
}

/** The window that has nothing left, as the status line names it. */
export interface StatusLimit {
  /** The name of the group as the card shows it. */
  readonly group: string;
  readonly window: AntigravityQuotaWindowKind;
  /** ISO time at which the window resets, `null` when none was named. */
  readonly resetsAt: string | null;
}

/** The limit an account states for itself, without naming a window or group. */
export interface GeneralStatusLimit {
  /** ISO time at which the limit ends, `null` when no reset belongs to it for certain. */
  readonly resetsAt: string | null;
}

/** What the presentation needs besides the status. */
export interface StatusFormat {
  readonly t: TFunction;
  /** Whose card the line belongs to; the provider names itself in the line. */
  readonly provider: QuotaAccount["provider"];
  /** The time of the provider's last answer as the card shows it. */
  readonly time: (iso: string) => string;
  /** A reset as the card shows it, such as `18:57` or `Mi 14:32`. */
  readonly moment: (iso: string) => string;
  /** The limit an Antigravity answer names; `null` or absent without one. */
  readonly limit?: StatusLimit | null;
  /** The limit a Codex answer states for the account; `null` or absent without one. */
  readonly generalLimit?: GeneralStatusLimit | null;
}

function lastStandPresentation(
  at: string,
  format: StatusFormat,
  action: StatusAction,
): StatusPresentation {
  const { t, time } = format;
  return {
    icon: Clock,
    tone: "muted",
    text: t("agentsPage.state.stored", { time: time(at) }),
    action,
  };
}

/**
 * The line of a card that answers from its stored figures.
 * @remarks
 * The line names the time of a stored answer. The initial load shows a spinner.
 */
function storedPresentation(
  at: string | null,
  format: StatusFormat,
): StatusPresentation {
  if (at === null)
    return {
      icon: "spinner",
      tone: "muted",
      text: format.t("agentsPage.state.loading"),
      action: "none",
    };
  return lastStandPresentation(at, format, "none");
}

/**
 * The line of a card with a window that has nothing left: group and window
 * name the limit, also when the group is out of sight in a scrolled list.
 */
function limitPresentation(
  limit: StatusLimit,
  format: StatusFormat,
): StatusPresentation {
  const { t, moment } = format;
  const values = {
    group: limit.group,
    limit: t(`agentsPage.limit.${limit.window}`),
  };
  return {
    icon: TriangleAlert,
    tone: "destructive",
    text:
      limit.resetsAt === null
        ? t("agentsPage.state.limitReachedNoReset", values)
        : t("agentsPage.state.limitReached", {
            ...values,
            moment: moment(limit.resetsAt),
          }),
    action: "none",
  };
}

/** The line of an account that states its limit is reached; a reset appears only when one belongs to it. */
function generalLimitPresentation(
  limit: GeneralStatusLimit,
  format: StatusFormat,
): StatusPresentation {
  const { t, moment } = format;
  return {
    icon: TriangleAlert,
    tone: "destructive",
    text:
      limit.resetsAt === null
        ? t("agentsPage.state.limitReachedGeneralNoReset")
        : t("agentsPage.state.limitReachedGeneral", {
            moment: moment(limit.resetsAt),
          }),
    action: "none",
  };
}

/** The line of a current answer, which names the provider that gave it. */
const REPORTED_TEXT: Readonly<Record<QuotaAccount["provider"], string>> = {
  claude_code: "agentsPage.state.reported",
  openrouter: "agentsPage.openRouter.reported",
  codex_cli: "agentsPage.state.reportedCodex",
  antigravity: "agentsPage.state.reportedAntigravity",
};

function reportedPresentation(
  at: string,
  format: StatusFormat,
): StatusPresentation {
  if (format.limit) return limitPresentation(format.limit, format);
  if (format.generalLimit)
    return generalLimitPresentation(format.generalLimit, format);
  return {
    icon: CircleCheck,
    tone: "success",
    text: format.t(REPORTED_TEXT[format.provider], { time: format.time(at) }),
    action: "none",
  };
}

function noWindowsPresentation(
  at: string,
  format: StatusFormat,
): StatusPresentation {
  return {
    icon: Info,
    tone: "muted",
    text: format.t("agentsPage.state.noWindows", { time: format.time(at) }),
    action: "none",
  };
}

function failedPresentation(
  lastSuccessAt: string | null,
  format: StatusFormat,
): StatusPresentation {
  if (lastSuccessAt !== null)
    return lastStandPresentation(lastSuccessAt, format, "retry");
  return {
    icon: TriangleAlert,
    tone: "warning",
    text: format.t("agentsPage.state.failedNever"),
    action: "retry",
  };
}

/**
 * Word, symbol, colour and action of each status.
 * @param status - The status of the card.
 * @param format - Translation, time format and provider limits.
 * @remarks
 * "Keine Fenster gemeldet" (the provider answered without a window) and
 * "Abfrage fehlgeschlagen" (Pages got no answer) never share a word, a
 * symbol or a colour. A missing sign-in is no failed query, so it offers the
 * connection settings instead of another attempt. During and after a missed
 * query, the last reading remains visible if available. A
 * current Antigravity answer with a used-up window names that limit instead
 * of the answer's time.
 */
export function statusPresentation(
  status: ClaudeQuotaStatus,
  format: StatusFormat,
): StatusPresentation {
  const { t } = format;
  switch (status.kind) {
    case "stored":
      return status.at !== null && (format.limit || format.generalLimit)
        ? reportedPresentation(status.at, format)
        : storedPresentation(status.at, format);
    case "reported":
      return reportedPresentation(status.at, format);
    case "no_windows":
      return noWindowsPresentation(status.at, format);
    case "failed":
      return failedPresentation(status.lastSuccessAt, format);
    case "skipped":
      if (status.lastSuccessAt !== null)
        return lastStandPresentation(status.lastSuccessAt, format, "none");
      return {
        icon: CirclePause,
        tone: "muted",
        text: t("agentsPage.state.skipped"),
        action: "none",
      };
    case "signed_out":
      return {
        icon: TriangleAlert,
        tone: "warning",
        text: t("agentsPage.state.signedOut"),
        action: "openConnection",
      };
  }
}
