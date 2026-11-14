import { useTranslation } from "react-i18next";

import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { sessionAttemptId } from "@/definition/AgentSessionJournal";

import { CodexUsageFacts } from "./codex-usage-facts";
import { useCodexRunUsage } from "./use-codex-run-usage";

import type { AgentPlanRun } from "@/definition/AgentPlan";

/** Polls the authorized session projection so token updates also arrive when the agent console is closed. */
export function PlanCodexUsage({
  run,
}: {
  readonly run: AgentPlanRun | null;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const results = run ? allPlanRunResults(run) : [];
  const chosen = results.find((step) => step.session?.runner === "codex_cli");
  const record = chosen?.session;
  const stepId = chosen?.id;
  const attemptId = record && stepId ? sessionAttemptId(record, stepId) : null;
  const runId = run?.id;
  const planId = run?.planId;
  const query = new URLSearchParams({
    attemptId: attemptId ?? "",
    planId: planId ?? "",
  });
  const url =
    runId && stepId && attemptId && planId
      ? `/agent-api/plan-runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/session?${query}`
      : null;
  const usage = useCodexRunUsage(url);
  if (!chosen || !run) return null;
  return (
    <section className="space-y-3" aria-label={t("codexUsage.title")}>
      <h3 className="text-sm font-semibold">{t("codexUsage.title")}</h3>
      {usage ? (
        <>
          <p className="text-xs font-medium">{t("codexUsage.runTotal")}</p>
          <CodexUsageFacts usage={usage.total} />
          {usage.steps.map((step) => (
            <div key={step.stepId} className="space-y-1">
              <p className="text-xs font-medium">
                {results.find((entry) => entry.id === step.stepId)?.name ??
                  step.stepId}
              </p>
              <CodexUsageFacts usage={step.usage} />
            </div>
          ))}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("codexUsage.notReported")}
        </p>
      )}
    </section>
  );
}
