import { CircleCheck, Clock, Info, TriangleAlert } from "lucide-react";

import { openRouterLimitShare } from "./openrouter-quota-format";
import { statusPresentation } from "./quota-status-presentation";

import type { OpenRouterQuotaAccount } from "@/definition/OpenRouterQuota";
import type { OpenRouterQuotaFormat } from "./openrouter-quota-format";
import type {
  StatusFormat,
  StatusPresentation,
} from "./quota-status-presentation";

function keyBudgetStatus(
  reading: OpenRouterQuotaAccount["key"]["reading"],
  { t, money }: OpenRouterQuotaFormat,
): StatusPresentation | null {
  if (!reading || typeof reading.limit !== "number") return null;
  if (reading.remaining === 0)
    return {
      icon: TriangleAlert,
      tone: "destructive",
      action: "none",
      text: t("agentsPage.openRouter.exhausted", { amount: money(0) }),
    };
  const share = openRouterLimitShare(reading);
  if (share === null || share >= 25 || reading.remaining === null) return null;
  return {
    icon: TriangleAlert,
    tone: "warning",
    action: "none",
    text: t("agentsPage.openRouter.nearlyExhausted", {
      amount: money(reading.remaining),
    }),
  };
}

function creditStatus(
  credits: OpenRouterQuotaAccount["credits"],
  format: OpenRouterQuotaFormat,
): StatusPresentation | null {
  const { t, money } = format;
  if (credits?.reading?.remaining === 0)
    return {
      icon: TriangleAlert,
      tone: "destructive",
      action: "none",
      text: t("agentsPage.openRouter.creditsExhausted", { amount: money(0) }),
    };
  if (credits?.status === "missing_key" || credits?.status === "invalid_key")
    return {
      icon: Info,
      tone: "muted",
      action: "openConnection",
      text: t(
        credits.status === "missing_key"
          ? "agentsPage.openRouter.managementMissing"
          : "agentsPage.openRouter.managementInvalid",
      ),
    };
  if (credits?.status === "unknown")
    return {
      icon: Info,
      tone: "muted",
      action: "retry",
      text: t("agentsPage.openRouter.creditsUnknown"),
    };
  return null;
}

function latestReading(account: OpenRouterQuotaAccount): string | null {
  const keyTime = account.key.reading?.at ?? "";
  const creditTime = account.credits?.reading?.at ?? "";
  return (keyTime > creditTime ? keyTime : creditTime) || null;
}

function reportedStatus(
  account: OpenRouterQuotaAccount,
  { t, time }: OpenRouterQuotaFormat,
  at: string | null,
): StatusPresentation {
  const { reading } = account.key;
  if (reading?.limit === null)
    return {
      icon: Info,
      tone: "muted",
      action: "none",
      text: t("agentsPage.openRouter.noLimitReported", {
        time: time(reading.at),
      }),
    };
  if (at === null)
    return {
      icon: Clock,
      tone: "muted",
      action: "none",
      text: t("agentsPage.openRouter.noReading"),
    };
  return {
    icon: CircleCheck,
    tone: "success",
    action: "none",
    text: t("agentsPage.openRouter.reported", { time: time(at) }),
  };
}

function combineReportedStatuses(
  account: OpenRouterQuotaAccount,
  format: OpenRouterQuotaFormat,
  at: string | null,
): StatusPresentation {
  const budget = keyBudgetStatus(account.key.reading, format);
  const credit = creditStatus(account.credits, format);
  if (credit && budget && credit.action !== "none")
    return {
      ...budget,
      action: credit.action,
      text: `${budget.text} · ${credit.text}`,
    };
  return credit ?? budget ?? reportedStatus(account, format, at);
}

function lastFailedReading(account: OpenRouterQuotaAccount): string | null {
  const { key, credits } = account;
  const keyAt = key.status === "failed" ? key.reading?.at : undefined;
  const creditsAt =
    credits?.status === "failed" ? credits.reading?.at : undefined;
  return keyAt ?? creditsAt ?? null;
}

/** The status and action for the two independently fetched OpenRouter readings. */
export function openRouterQuotaStatus(
  account: OpenRouterQuotaAccount,
  format: OpenRouterQuotaFormat,
  isHintShown: boolean,
): StatusPresentation {
  const { key, credits } = account;
  const { t, time } = format;
  const sharedFormat: StatusFormat = {
    t,
    time,
    provider: "openrouter",
    moment: time,
    isHintShown,
  };
  if (key.status === "failed" || credits?.status === "failed")
    return statusPresentation(
      { kind: "failed", lastSuccessAt: lastFailedReading(account) },
      sharedFormat,
    );
  if (key.status === "invalid_key")
    return {
      icon: TriangleAlert,
      tone: "warning",
      action: "openConnection",
      text: t("agentsPage.openRouter.invalidKey"),
    };
  const at = latestReading(account);
  if (key.status === "stored" || isHintShown)
    return statusPresentation({ kind: "stored", at }, sharedFormat);
  return combineReportedStatuses(account, format, at);
}
