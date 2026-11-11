import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { ManagementTable } from "@/app/components/users/management-table";

import { StatusText, TriggerChipView } from "./automation-chips";
import { runTriggerChip } from "./automation-labels";
import { runSummaryText, runTone } from "./automation-run-summary";
import { formatDuration, formatRunMoment } from "./automation-time-format";

import type { AutomationRunSummary } from "@/definition/Automation";
import type { AutomationsPageState } from "./use-automations-page";

const COLUMNS = [
  "time",
  "automation",
  "trigger",
  "result",
  "duration",
] as const;

/** One run of the history; it opens its details. */
function HistoryRow({
  run,
  page,
}: {
  readonly run: AutomationRunSummary;
  readonly page: AutomationsPageState;
}): React.ReactElement {
  const { context } = page;
  const automation = page.pageData.automations.find(
    (entry) => entry.id === run.automationId,
  );
  function open(): void {
    page.selection.setOpenRun({
      automationId: run.automationId,
      runId: run.runId,
    });
  }
  return (
    <tr
      className="cursor-pointer transition-colors hover:bg-muted/40"
      onClick={open}
    >
      <td className="px-4 py-3 text-sm whitespace-nowrap">
        {formatRunMoment(run.startedAt ?? run.queuedAt, context)}
      </td>
      <td className="px-4 py-3">
        <button
          className="text-left text-sm font-semibold text-foreground outline-none focus-visible:underline"
          onClick={(event) => {
            event.stopPropagation();
            open();
          }}
          type="button"
        >
          {run.automationName}
        </button>
      </td>
      <td className="px-4 py-3">
        <TriggerChipView chip={runTriggerChip(run, automation, context)} />
      </td>
      <td className="px-4 py-3 text-xs">
        <StatusText
          tone={runTone(run)}
          text={runSummaryText({ run, automation, place: "history" }, context)}
        />
      </td>
      <td className="px-4 py-3 text-sm whitespace-nowrap text-muted-foreground">
        {formatDuration(run.duration, context.t)}
      </td>
    </tr>
  );
}

/** "Verlauf": the newest runs of every visible automation, newest first. */
export function AutomationHistoryTable({
  page,
}: {
  readonly page: AutomationsPageState;
}): React.ReactElement {
  const { t } = page.context;
  const { history } = page.pageData;
  return (
    <VerticalScrollArea
      className="min-h-0 min-w-0 flex-1"
      contentClassName="px-1 pt-1 pb-10"
    >
      <ManagementTable>
        <thead className="sticky top-0 z-10 bg-muted/40 text-xs font-medium text-muted-foreground">
          <tr>
            {COLUMNS.map((column) => (
              <th key={column} className="px-4 py-3 font-medium">
                {t(`automations.history.columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {history.map((run) => (
            <HistoryRow key={run.runId} run={run} page={page} />
          ))}
          {history.length === 0 ? (
            <tr>
              <td
                colSpan={COLUMNS.length}
                className="px-4 py-10 text-center text-sm text-muted-foreground"
              >
                {t("automations.history.empty")}
              </td>
            </tr>
          ) : null}
        </tbody>
      </ManagementTable>
    </VerticalScrollArea>
  );
}
