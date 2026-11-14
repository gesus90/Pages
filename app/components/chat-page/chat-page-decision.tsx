import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { percentText, probabilitiesText } from "./chat-page-decision-text";

import type { ConversationDecisionView } from "@/definition/ConversationDecision";

/** The probabilities the decision model gave, and the model that gave them. */
function DecisionDetails({
  decision,
}: {
  readonly decision: ConversationDecisionView;
}): React.ReactElement {
  const { t } = useTranslation();
  const probabilities = probabilitiesText(decision, t);
  return (
    <div className="space-y-1">
      {probabilities === "" ? null : <p>{probabilities}</p>}
      {decision.model === null ? null : (
        <p>{t("chatPage.decision.modelLine", { model: decision.model })}</p>
      )}
    </div>
  );
}

/** The probability of the option "nobody", when the model gave one. */
function nobodyProbability(decision: ConversationDecisionView): number | null {
  return (
    decision.choices.find((choice) => choice.agentId === null)?.probability ??
    null
  );
}

function Collapsible({
  summary,
  decision,
}: {
  readonly summary: string;
  readonly decision: ConversationDecisionView;
}): React.ReactElement {
  return (
    <details className="group max-w-[62%] min-w-0 text-xs text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-1 py-0.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none">
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 shrink-0 transition-transform group-open:rotate-90"
        />
        <span className="min-w-0 truncate">{summary}</span>
      </summary>
      <div className="mt-1 rounded-lg bg-muted px-3 py-2">
        <DecisionDetails decision={decision} />
      </div>
    </details>
  );
}

/**
 * What the decision model decided about a message of a group (PAGE-379).
 *
 * @remarks
 * Under the message of a person that nobody answers it is the quiet system
 * line "keine Antwort · niemand 91 %", visible to every member; a click shows
 * the probabilities. On the answer an agent gave because the decision model
 * chose it, it is "Warum?" with the same probabilities, for example "Antwort
 * erwartet 82 % · Ed 78 %, Mei 15 %, niemand 7 %".
 */
export function ChatPageDecision({
  decision,
}: {
  readonly decision: ConversationDecisionView;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (decision.outcome === "nobody") {
    const nobody = nobodyProbability(decision);
    return (
      <Collapsible
        decision={decision}
        summary={
          nobody === null
            ? t("chatPage.decision.noAnswer")
            : t("chatPage.decision.noAnswerWith", {
                probability: percentText(nobody),
              })
        }
      />
    );
  }
  if (decision.outcome !== "responders") return null;
  return (
    <Collapsible decision={decision} summary={t("chatPage.decision.why")} />
  );
}
