import { useTranslation } from "react-i18next";

import {
  distributionText,
  percentText,
} from "@/app/components/chat-page/chat-page-decision-text";

import type { TFunction } from "i18next";
import type { ConversationDecisionEntry } from "@/definition/ConversationDecision";

/** The row grid: time, message, "Antwort erwartet", distribution and result. */
const ROW_GRID =
  "md:grid md:grid-cols-[7.5rem_minmax(0,1.4fr)_5.5rem_minmax(0,1.2fr)_minmax(0,1fr)] md:gap-x-4";

/** What the decision led to, in words: who answers, no answer, an @ addressing or an unavailable model. */
function resultText(
  entry: ConversationDecisionEntry,
  translate: TFunction,
): string {
  const names = entry.responders.map((agent) => agent.name).join(", ");
  switch (entry.outcome) {
    case "responders":
      return translate("chatPage.replySettings.decisions.result.responders", {
        names,
      });
    case "mention":
      return translate("chatPage.replySettings.decisions.result.mention", {
        names,
      });
    case "unavailable":
      return translate(
        `chatPage.replySettings.decisions.result.unavailable.${entry.fallback}`,
      );
    case "nobody":
      return translate("chatPage.replySettings.decisions.result.nobody");
  }
}

function Cell({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex gap-2 md:block">
      <span className="w-28 shrink-0 text-xs text-muted-foreground md:hidden">
        {label}
      </span>
      <span className="min-w-0 text-sm break-words">{children}</span>
    </div>
  );
}

function DecisionRow({
  entry,
}: {
  readonly entry: ConversationDecisionEntry;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const time = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(entry.createdAt));
  return (
    <li
      className={`flex flex-col gap-1 border-b border-border py-3 last:border-b-0 ${ROW_GRID}`}
    >
      <Cell label={t("chatPage.replySettings.decisions.time")}>{time}</Cell>
      <Cell label={t("chatPage.replySettings.decisions.message")}>
        {entry.text}
      </Cell>
      <Cell label={t("chatPage.replySettings.decisions.expected")}>
        {entry.answerProbability === null
          ? "—"
          : percentText(entry.answerProbability)}
      </Cell>
      <Cell label={t("chatPage.replySettings.decisions.distribution")}>
        {entry.choices.length === 0 ? "—" : distributionText(entry, t)}
      </Cell>
      <Cell label={t("chatPage.replySettings.decisions.result.label")}>
        <span className="font-medium">{resultText(entry, t)}</span>
      </Cell>
    </li>
  );
}

/**
 * The tab "Letzte Entscheidungen" (PAGE-379): time, message, the chance that
 * an answer is expected, the distribution among the agents and nobody, and the
 * result, including "keine Antwort" and @ addressings.
 */
export function ReplyDecisionsTab({
  decisions,
}: {
  readonly decisions: readonly ConversationDecisionEntry[] | null;
}): React.ReactElement {
  const { t } = useTranslation();
  if (decisions === null)
    return (
      <p className="px-6 py-5 text-sm text-muted-foreground">
        {t("chatPage.replySettings.decisions.loading")}
      </p>
    );
  if (decisions.length === 0)
    return (
      <p className="px-6 py-5 text-sm text-muted-foreground">
        {t("chatPage.replySettings.decisions.empty")}
      </p>
    );
  return (
    <div className="px-6 pt-3 pb-5">
      <div
        aria-hidden="true"
        className={`hidden border-b border-border pb-2 text-xs font-medium text-muted-foreground ${ROW_GRID}`}
      >
        <span>{t("chatPage.replySettings.decisions.time")}</span>
        <span>{t("chatPage.replySettings.decisions.message")}</span>
        <span>{t("chatPage.replySettings.decisions.expected")}</span>
        <span>{t("chatPage.replySettings.decisions.distribution")}</span>
        <span>{t("chatPage.replySettings.decisions.result.label")}</span>
      </div>
      <ul>
        {decisions.map((entry) => (
          <DecisionRow key={entry.messageId} entry={entry} />
        ))}
      </ul>
    </div>
  );
}
