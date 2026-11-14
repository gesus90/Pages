import { useTranslation } from "react-i18next";

import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { sessionAttemptId } from "@/definition/AgentSessionJournal";

import { CodexUsageFacts } from "./codex-usage-facts";
import { useCodexRunUsage } from "./use-codex-run-usage";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { CodexRunUsage } from "@/definition/CodexPlanUsage";

function codexUsageUrl(
  run: AgentPlanRun | null,
  chosen: AgentPlanStepResult | undefined,
): string | null {
  if (!run || !chosen?.session) return null;
  const attemptId = sessionAttemptId(chosen.session, chosen.id);
  if (!attemptId) return null;
  const query = new URLSearchParams({ attemptId, planId: run.planId });
  return `/agent-api/plan-runs/${encodeURIComponent(run.id)}/steps/${encodeURIComponent(chosen.id)}/session?${query}`;
}

function CodexRunUsageContent({
  usage,
  results,
}: {
  readonly usage: CodexRunUsage | null;
  readonly results: readonly AgentPlanStepResult[];
}): React.ReactElement {
  const { t } = useTranslation();
  if (!usage) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("codexUsage.notReported")}
      </p>
    );
  }
  return (
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
  );
}

/** Polls the authorized session projection so token updates also arrive when the agent console is closed. */
export function PlanCodexUsage({
  run,
}: {
  readonly run: AgentPlanRun | null;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const results = run ? allPlanRunResults(run) : [];
  const chosen = results.find((step) => step.session?.runner === "codex_cli");
  const usage = useCodexRunUsage(codexUsageUrl(run, chosen));
  if (!chosen || !run) return null;
  return (
    <section className="space-y-3" aria-label={t("codexUsage.title")}>
      <h3 className="text-sm font-semibold">{t("codexUsage.title")}</h3>
      <CodexRunUsageContent usage={usage} results={results} />
    </section>
  );
}
