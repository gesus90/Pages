import { StatusText } from "./automation-chips";
import { runSummaryText, runTone } from "./automation-run-summary";
import { EMPTY_CELL, formatPastMoment } from "./automation-time-format";

import type { Automation, AutomationRunSummary } from "@/definition/Automation";
import type { LabelContext } from "./automation-time-format";
import type { RunReference } from "./use-automation-run";

const SHOWN_RUNS = 5;

interface RunsListProps {
  readonly automation: Automation;
  readonly history: readonly AutomationRunSummary[];
  readonly context: LabelContext;
  readonly onOpen: (run: RunReference) => void;
}

/** The newest runs of an automation: its last run and the ones of the history. */
export function automationRuns(
  automation: Automation,
  history: readonly AutomationRunSummary[],
): readonly AutomationRunSummary[] {
  const runs = history.filter((run) => run.automationId === automation.id);
  const lastRun = automation.lastRun;
  if (lastRun && !runs.some((run) => run.runId === lastRun.runId))
    runs.unshift(lastRun);
  return runs.slice(0, SHOWN_RUNS);
}

/** "Letzte Läufe" of the panel; a run opens its details. */
export function RunsList({
  automation,
  history,
  context,
  onOpen,
}: RunsListProps): React.ReactElement {
  const { t } = context;
  const runs = automationRuns(automation, history);
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs text-muted-foreground">
        {t("automations.panel.lastRuns")}
      </h3>
      {runs.length === 0 ? (
        <p className="grid grid-cols-[6rem_1fr] gap-3 py-1.5 text-sm text-muted-foreground">
          <span>{EMPTY_CELL}</span>
          <span>{t("automations.panel.noRuns")}</span>
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60">
          {runs.map((run) => (
            <li key={run.runId}>
              <button
                className="grid w-full grid-cols-[6rem_1fr] items-center gap-3 rounded-md py-2 text-left text-sm transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                onClick={() =>
                  onOpen({ automationId: run.automationId, runId: run.runId })
                }
                type="button"
              >
                <span className="text-muted-foreground">
                  {formatPastMoment(run.startedAt ?? run.queuedAt, context)}
                </span>
                <StatusText
                  tone={runTone(run)}
                  text={runSummaryText(
                    { run, automation, place: "panel" },
                    context,
                  )}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
