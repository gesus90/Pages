import { ChevronRight, CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ConversationDecisionView } from "@/definition/ConversationDecision";

function names(agents: ConversationDecisionView["responders"]): string {
  return agents.map((agent) => agent.name).join(", ");
}

/** The one line a collapsed decision shows: who answers, or that nobody does. */
function summaryText(
  decision: ConversationDecisionView,
  translate: ReturnType<typeof useTranslation>["t"],
): string {
  if (decision.outcome === "responders" || decision.outcome === "default")
    return translate("chatPage.decision.summary.responders", {
      names: names(decision.responders),
    });
  return translate("chatPage.decision.summary.nobody");
}

function DetailRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="font-medium text-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function DecisionDetails({
  decision,
}: {
  readonly decision: ConversationDecisionView;
}): React.ReactElement {
  const { t } = useTranslation();
  const needs =
    decision.needsAnswer === null
      ? null
      : t(
          decision.needsAnswer
            ? "chatPage.decision.needsAnswerYes"
            : "chatPage.decision.needsAnswerNo",
        );
  return (
    <dl className="mt-1.5 space-y-1">
      <DetailRow label={t("chatPage.decision.chosen")}>
        {decision.responders.length > 0
          ? names(decision.responders)
          : t("chatPage.decision.nobody")}
      </DetailRow>
      {needs === null ? null : (
        <DetailRow label={t("chatPage.decision.needsAnswer")}>
          {needs}
        </DetailRow>
      )}
      {decision.suggested.length > 0 ? (
        <DetailRow label={t("chatPage.decision.suggested")}>
          {names(decision.suggested)}
        </DetailRow>
      ) : null}
      <DetailRow label={t("chatPage.decision.fallback")}>
        {t(`chatPage.decision.fallbacks.${decision.fallback}`)}
      </DetailRow>
    </dl>
  );
}

/** The system hint that stands in for an answer when nobody could be asked. */
function NoAnswerNotice({
  decision,
}: {
  readonly decision: ConversationDecisionView;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <p
      role="note"
      className="flex items-start gap-2 text-sm text-muted-foreground"
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        {t("chatPage.decision.notice")}
        {decision.suggested.length > 0
          ? ` ${t("chatPage.decision.noticeSuggested", { names: names(decision.suggested) })}`
          : ""}
      </span>
    </p>
  );
}

function visibleReason(
  decision: ConversationDecisionView,
  translate: ReturnType<typeof useTranslation>["t"],
): string {
  if (decision.reason !== "") return decision.reason;
  return translate(
    decision.fallback === "none"
      ? "chatPage.decision.noReason"
      : `chatPage.decision.fallbacks.${decision.fallback}`,
  );
}

/**
 * The decision about who answers a message of a group (PAGE-317), as a
 * collapsible line with a visible reason: the chosen agent or nobody, and
 * whether a fallback applied. Where nobody answered because it was unclear
 * who is addressed, a hint says so openly.
 */
export function ChatPageDecision({
  decision,
}: {
  readonly decision: ConversationDecisionView;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex max-w-[62%] min-w-0 flex-col gap-1.5">
      <details className="group min-w-0 text-xs text-muted-foreground">
        <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-1 py-0.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none">
          <ChevronRight
            aria-hidden="true"
            className="size-3.5 shrink-0 transition-transform group-open:rotate-90"
          />
          <span className="min-w-0 truncate">{summaryText(decision, t)}</span>
          {decision.fallback === "none" ? null : (
            <span className="shrink-0 rounded-full bg-warning-subtle px-1.5 py-0.5 text-[11px] font-semibold text-warning">
              {t("chatPage.decision.fallbackBadge")}
            </span>
          )}
        </summary>
        <div className="rounded-lg bg-muted px-3 py-2">
          <DecisionDetails decision={decision} />
        </div>
      </details>
      <p className="text-xs text-muted-foreground" data-decision-reason="">
        {visibleReason(decision, t)}
      </p>
      {decision.outcome === "notice" ? (
        <NoAnswerNotice decision={decision} />
      ) : null}
    </div>
  );
}
