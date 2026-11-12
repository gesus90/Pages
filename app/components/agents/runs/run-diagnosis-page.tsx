import { useState } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";

import { RunDetail } from "./run-detail";
import { EMPTY_RUN_FILTERS } from "./run-diagnosis-model";
import { RunFailureOverview } from "./run-failure-overview";
import { RunFiltersForm } from "./run-filters";
import { RunList } from "./run-list";
import { useRunDiagnosisQuery } from "./use-run-diagnosis-query";

import type { RunDiagnosisAnswers, RunFilters } from "./run-diagnosis-model";

const PLAN_QUERY = {};

function isPlans(value: unknown): value is RunDiagnosisAnswers["plans"] {
  return (
    typeof value === "object" &&
    value !== null &&
    "plans" in value &&
    "userId" in value
  );
}

/**
 * The view "Runs" of the plan area (PAGE-307): runs of all plans the person may see,
 * filters, the failure overview and one run with its steps, timeline and logs.
 */
export function RunDiagnosisPage(): React.ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState<RunFilters>({
    ...EMPTY_RUN_FILTERS,
    planId: params.get("planId") ?? "",
  });
  const plans = useRunDiagnosisQuery("plans", PLAN_QUERY, isPlans).data;
  const runId = params.get("runId");

  function openRun(id: string): void {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("runId", id);
      return next;
    });
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">
          {t("runDiagnosis.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("runDiagnosis.subtitle")}
        </p>
      </header>
      <RunFiltersForm filters={filters} plans={plans} onChange={setFilters} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-5">
          <RunFailureOverview filters={filters} onOpenRun={openRun} />
          <RunList filters={filters} selectedRunId={runId} onSelect={openRun} />
        </div>
        <div>
          {runId ? (
            <RunDetail key={runId} runId={runId} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("runDiagnosis.detail.choose")}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
