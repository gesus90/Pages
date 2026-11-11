import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { formatLocalTime } from "@/app/components/agents/plans/plan-agent-console/console-time";

import { RunErrorBadge } from "./run-error-badge";
import { RunStatusBadge } from "./run-status-badge";
import { filterQuery, RUN_DIAGNOSIS_ENDPOINT } from "./run-diagnosis-model";

import type {
  AgentRunList,
  AgentRunListEntry,
} from "@/definition/AgentRunDiagnosis";
import type { RunFilters } from "./run-diagnosis-model";

const RUN_FILTER_NAMES = [
  "planId",
  "status",
  "errorClass",
  "stepId",
  "startedById",
  "from",
  "to",
] as const;

function isRunList(value: unknown): value is AgentRunList {
  return typeof value === "object" && value !== null && "runs" in value;
}

interface Loaded {
  readonly runs: readonly AgentRunListEntry[];
  readonly total: number;
  readonly nextCursor: string | null;
}

/** Reads one page of the run list; an old page stays on screen while the next one loads. */
async function readPage(
  filters: RunFilters,
  cursor: string | null,
  signal: AbortSignal,
): Promise<AgentRunList> {
  const query = new URLSearchParams({
    view: "runs",
    ...filterQuery(filters, RUN_FILTER_NAMES),
    ...(cursor === null ? {} : { cursor }),
  });
  const response = await fetch(
    `${RUN_DIAGNOSIS_ENDPOINT}?${query.toString()}`,
    {
      signal,
      cache: "no-store",
    },
  );
  const body: unknown = await response.json();
  if (!response.ok || !isRunList(body)) throw new Error("run list");
  return body;
}

function useRunPages(filters: RunFilters): {
  readonly loaded: Loaded | null;
  readonly isLoading: boolean;
  readonly isFailed: boolean;
  readonly loadMore: () => void;
} {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [isFailed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    readPage(filters, null, controller.signal)
      .then((page) => setLoaded(page))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filters]);

  const loadMore = useCallback((): void => {
    if (loaded?.nextCursor == null) return;
    setLoading(true);
    void readPage(filters, loaded.nextCursor, new AbortController().signal)
      .then((page) =>
        setLoaded({ ...page, runs: [...loaded.runs, ...page.runs] }),
      )
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [filters, loaded]);

  return { loaded, isLoading, isFailed, loadMore };
}

/** The runs of all visible plans, newest first, with their starter and failure; more load on request. */
export function RunList({
  filters,
  selectedRunId,
  onSelect,
}: {
  readonly filters: RunFilters;
  readonly selectedRunId: string | null;
  readonly onSelect: (runId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { loaded, isLoading, isFailed, loadMore } = useRunPages(filters);
  return (
    <section className="space-y-3" aria-labelledby="run-list-title">
      <h2 id="run-list-title" className="text-sm font-semibold text-foreground">
        {t("runDiagnosis.runs.title")}
        {loaded ? (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {t("runDiagnosis.runs.total", { count: loaded.total })}
          </span>
        ) : null}
      </h2>
      {isFailed ? (
        <p role="alert" className="text-sm text-destructive">
          {t("runDiagnosis.loadFailed")}
        </p>
      ) : null}
      {loaded && loaded.runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("runDiagnosis.runs.empty")}
        </p>
      ) : null}
      <ul className="space-y-1.5">
        {(loaded?.runs ?? []).map((run) => (
          <li key={run.runId}>
            <button
              type="button"
              aria-current={run.runId === selectedRunId}
              onClick={() => onSelect(run.runId)}
              className={cn(
                "w-full space-y-1 rounded-xl border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-hover",
                run.runId === selectedRunId &&
                  "border-primary bg-primary-subtle hover:bg-primary-subtle",
              )}
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {run.planName}
                </span>
                <RunStatusBadge status={run.status} />
                {run.errorClass !== null ? (
                  <RunErrorBadge
                    errorClass={run.errorClass}
                    errorCode={run.errorCode}
                  />
                ) : null}
              </span>
              <span className="block text-xs text-muted-foreground">
                {t("runDiagnosis.runs.startedBy", {
                  name: run.startedBy.displayName,
                  time: formatLocalTime(run.startedAt) ?? run.startedAt,
                })}
                {run.failedStepId
                  ? ` · ${t("runDiagnosis.runs.failedStep", { step: run.failedStepId })}`
                  : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {loaded?.nextCursor ? (
        <Button
          size="sm"
          variant="outline"
          disabled={isLoading}
          onClick={loadMore}
        >
          {t("runDiagnosis.runs.loadMore")}
        </Button>
      ) : null}
      {isLoading && !loaded ? (
        <p className="text-sm text-muted-foreground">
          {t("runDiagnosis.loading")}
        </p>
      ) : null}
    </section>
  );
}
