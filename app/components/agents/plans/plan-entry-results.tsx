import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { planAssetUrl } from "@/app/lib/plan-asset-upload";

import { planEntryResults } from "./plan-entry-results-model";

import type { AgentPlanInput, AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanAssetFile } from "@/definition/AgentPlanAsset";
import type {
  PlanEntryResult,
  PlanEntryResults,
  PlanEntryState,
} from "./plan-entry-results-model";

const STATE_TONES: Readonly<Record<PlanEntryState, string>> = {
  waiting: "text-muted-foreground",
  running: "text-info",
  done: "text-success",
  failed: "text-destructive",
};

function Thumbnail(props: {
  readonly file: Pick<AgentPlanAssetFile, "assetId" | "kind"> | null;
}): React.ReactElement {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
      {props.file?.kind === "image" ? (
        <img
          src={planAssetUrl(props.file.assetId)}
          alt=""
          className="size-full object-cover"
        />
      ) : null}
    </span>
  );
}

function ResultCell(props: {
  readonly row: PlanEntryResult;
}): React.ReactElement {
  const { t } = useTranslation();
  const { row } = props;
  if (row.state === "failed")
    return (
      <span className="min-w-0 text-xs text-destructive">
        {t(`settings.agents.error.${row.error ?? "plan_step_failed"}`, {
          defaultValue: row.error ?? t("plans.entryResults.failed"),
        })}
      </span>
    );
  if (row.resultFile)
    return (
      <a
        href={planAssetUrl(row.resultFile.assetId)}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-0 items-center gap-2 text-xs hover:underline"
      >
        <Thumbnail
          file={
            row.file.kind === "image"
              ? { assetId: row.resultFile.assetId, kind: "image" }
              : null
          }
        />
        <span className="truncate">{row.resultFile.fileName}</span>
      </a>
    );
  return (
    <span className="min-w-0 truncate text-xs text-muted-foreground">
      {row.summary ??
        (row.state === "running" ? t("plans.entryResults.producing") : "—")}
    </span>
  );
}

function StackResults(props: {
  readonly results: PlanEntryResults;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ol
      aria-label={props.results.name}
      className="divide-y divide-border rounded-lg border border-border"
    >
      {props.results.rows.map((row) => (
        <li
          key={row.entryId}
          data-plan-entry-result={row.entryId}
          data-plan-entry-state={row.state}
          className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)] items-center gap-2 px-2 py-1.5"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Thumbnail file={row.file} />
            <span
              className="truncate text-xs font-semibold"
              title={row.file.fileName}
            >
              {row.position} · {row.file.fileName}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <ArrowRight
              aria-hidden="true"
              className="size-3 text-muted-foreground"
            />
            <span
              className={cn("text-xs font-semibold", STATE_TONES[row.state])}
            >
              {t(`plans.entryResults.state.${row.state}`)}
            </span>
          </span>
          <ResultCell row={row} />
        </li>
      ))}
    </ol>
  );
}

/**
 * „Ergebnisse pro Eintrag“: every file a stack handed over, with its status
 * and its result, in the details of the shown run (PAGE-268).
 *
 * @remarks
 * A failed entry keeps its error in its own row; the others show their
 * results. Nothing is shown for a run without file entries.
 */
export function PlanEntryResultsOverview(props: {
  readonly plan: AgentPlanInput;
  readonly run: AgentPlanRun | null;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!props.run) return null;
  const overviews = planEntryResults(props.plan, props.run);
  if (overviews.length === 0) return null;
  return (
    <section data-plan-entry-results="" className="space-y-2">
      <h3 className="text-sm font-semibold">{t("plans.entryResults.title")}</h3>
      {overviews.map((results) => (
        <div key={results.stackId} className="space-y-1">
          {overviews.length > 1 ? (
            <p className="text-xs text-muted-foreground">{results.name}</p>
          ) : null}
          <StackResults results={results} />
        </div>
      ))}
    </section>
  );
}
