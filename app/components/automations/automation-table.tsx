import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { ManagementTable } from "@/app/components/users/management-table";
import { cn } from "@/app/lib/cn";

import { StatusText, TriggerChipView } from "./automation-chips";
import { actionLine, triggerChip } from "./automation-labels";
import { lastRunText, runTone } from "./automation-run-summary";
import { AutomationSwitch } from "./automation-switch";
import { formatNextRun } from "./automation-time-format";

import type { Automation } from "@/definition/Automation";
import type { AutomationsPageState } from "./use-automations-page";

const COLUMNS = [
  "automation",
  "trigger",
  "nextRun",
  "lastRun",
  "active",
] as const;

interface RowProps {
  readonly automation: Automation;
  readonly page: AutomationsPageState;
  readonly isSelected: boolean;
}

/** One automation: name and action, trigger, next and last run, switch. */
function AutomationRow({
  automation,
  page,
  isSelected,
}: RowProps): React.ReactElement {
  const { context } = page;
  const { t } = context;
  return (
    <tr
      aria-current={isSelected ? "true" : undefined}
      className={cn(
        "cursor-pointer transition-colors hover:bg-muted/40",
        isSelected && "lg:bg-surface-hover",
      )}
      onClick={() => page.selectRow(automation)}
    >
      <td className="px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <button
              className="text-left text-sm font-semibold text-foreground outline-none focus-visible:underline"
              onClick={(event) => {
                event.stopPropagation();
                page.selectRow(automation);
              }}
              type="button"
            >
              {automation.name}
            </button>
            {automation.trigger.type === "once" &&
            automation.deleteAfterSuccess ? (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                {t("automations.table.selfDeleting")}
              </span>
            ) : null}
          </span>
          <span className="text-xs text-muted-foreground">
            {actionLine(automation.action, context)}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <TriggerChipView chip={triggerChip(automation.trigger, context)} />
      </td>
      <td
        className={cn(
          "px-4 py-3 text-sm whitespace-nowrap",
          automation.isActive && automation.nextRunAt
            ? "text-foreground"
            : "text-muted-foreground",
        )}
      >
        {formatNextRun(automation, context)}
      </td>
      <td className="px-4 py-3 text-xs whitespace-nowrap">
        <StatusText
          tone={runTone(automation.lastRun)}
          text={lastRunText(automation.lastRun, context)}
        />
      </td>
      <td className="px-4 py-3">
        <AutomationSwitch
          checked={automation.isActive}
          disabled={!automation.permissions.canEdit}
          label={t("automations.table.activeLabel", { name: automation.name })}
          onChange={() => page.toggleActive(automation)}
        />
      </td>
    </tr>
  );
}

/** The table of the automations of the tab; on narrow screens the panel replaces it. */
export function AutomationTable({
  page,
}: {
  readonly page: AutomationsPageState;
}): React.ReactElement {
  const { t } = page.context;
  const { visible, shown } = page.selection;
  const selectedId = page.editor.mode === "create" ? null : shown?.id;
  return (
    <VerticalScrollArea
      className={cn(
        "min-h-0 min-w-0 flex-1",
        page.isDetailOpen && "hidden lg:grid",
      )}
      contentClassName="px-1 pt-1 pb-10"
    >
      <ManagementTable>
        <thead className="sticky top-0 z-10 bg-muted/40 text-xs font-medium text-muted-foreground">
          <tr>
            {COLUMNS.map((column) => (
              <th key={column} className="px-4 py-3 font-medium">
                {t(`automations.table.columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {visible.map((automation) => (
            <AutomationRow
              key={automation.id}
              automation={automation}
              page={page}
              isSelected={automation.id === selectedId}
            />
          ))}
          {visible.length === 0 ? (
            <tr>
              <td
                colSpan={COLUMNS.length}
                className="px-4 py-10 text-center text-sm text-muted-foreground"
              >
                {t("automations.table.empty")}
              </td>
            </tr>
          ) : null}
        </tbody>
      </ManagementTable>
    </VerticalScrollArea>
  );
}
