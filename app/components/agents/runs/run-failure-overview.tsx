import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Tabs } from "@/app/components/ui/tabs";
import { formatLocalTime } from "@/app/components/agents/plans/plan-agent-console/console-time";

import { RunErrorBadge, RunErrorHint } from "./run-error-badge";
import { filterQuery } from "./run-diagnosis-model";
import { useRunDiagnosisQuery } from "./use-run-diagnosis-query";

import type {
  AgentRunFailureGroup,
  AgentRunFailureGrouping,
} from "@/definition/AgentRunDiagnosis";
import type { RunDiagnosisAnswers, RunFilters } from "./run-diagnosis-model";

function isFailureSummary(
  value: unknown,
): value is RunDiagnosisAnswers["failures"] {
  return typeof value === "object" && value !== null && "groups" in value;
}

const GROUPINGS: readonly AgentRunFailureGrouping[] = [
  "errorClass",
  "plan",
  "step",
];

function isGrouping(value: string): value is AgentRunFailureGrouping {
  return GROUPINGS.some((grouping) => grouping === value);
}

function GroupTitle({
  group,
  grouping,
}: {
  readonly group: AgentRunFailureGroup;
  readonly grouping: AgentRunFailureGrouping;
}): React.ReactElement {
  if (grouping === "errorClass" && group.errorClass !== null)
    return <RunErrorBadge errorClass={group.errorClass} />;
  return (
    <span className="text-sm font-medium text-foreground">
      {group.planName}
      {group.stepLabel ? ` · ${group.stepLabel}` : ""}
    </span>
  );
}

/** The failed steps grouped by error class, plan or step, with counts, first and last occurrence and example runs. */
export function RunFailureOverview({
  filters,
  onOpenRun,
}: {
  readonly filters: RunFilters;
  readonly onOpenRun: (runId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [grouping, setGrouping] =
    useState<AgentRunFailureGrouping>("errorClass");
  const query = useRunDiagnosisQuery(
    "failures",
    { ...filterQuery(filters, ["planId", "from", "to"]), groupBy: grouping },
    isFailureSummary,
  );
  const summary = query.data;
  return (
    <section className="space-y-3" aria-labelledby="run-failures-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="run-failures-title"
          className="text-sm font-semibold text-foreground"
        >
          {t("runDiagnosis.failures.title")}
          {summary ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {t("runDiagnosis.failures.total", {
                count: summary.totalFailedSteps,
              })}
            </span>
          ) : null}
        </h2>
        <Tabs
          value={grouping}
          onValueChange={(value) => {
            if (isGrouping(value)) setGrouping(value);
          }}
          ariaLabel={t("runDiagnosis.failures.groupBy")}
          tabs={GROUPINGS.map((entry) => ({
            value: entry,
            label: t(`runDiagnosis.failures.grouping.${entry}`),
          }))}
        />
      </div>
      {query.isFailed ? (
        <p role="alert" className="text-sm text-destructive">
          {t("runDiagnosis.loadFailed")}
        </p>
      ) : null}
      {summary && summary.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("runDiagnosis.failures.empty")}
        </p>
      ) : null}
      <ul className="space-y-2">
        {(summary?.groups ?? []).map((group) => (
          <li
            key={`${group.errorClass ?? ""}:${group.planId ?? ""}:${group.stepId ?? ""}`}
            className="space-y-1.5 rounded-xl border border-border bg-surface px-3 py-2.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <GroupTitle group={group} grouping={grouping} />
              <span className="ml-auto text-sm font-semibold text-foreground">
                {t("runDiagnosis.failures.count", { count: group.count })}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("runDiagnosis.failures.span", {
                first: formatLocalTime(group.firstAt) ?? group.firstAt,
                last: formatLocalTime(group.lastAt) ?? group.lastAt,
              })}
            </p>
            {group.errorClass !== null ? (
              <RunErrorHint errorClass={group.errorClass} />
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              {group.exampleRunIds.map((runId) => (
                <button
                  key={runId}
                  type="button"
                  onClick={() => onOpenRun(runId)}
                  className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground hover:bg-sidebar-hover"
                >
                  {runId.slice(0, 8)}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
