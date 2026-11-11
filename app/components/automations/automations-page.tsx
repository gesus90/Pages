import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Tabs, TabsContent } from "@/app/components/ui/tabs";

import { AutomationDeleteDialog } from "./automation-delete-dialog";
import { AutomationHistoryTable } from "./automation-history-table";
import { AutomationPanel } from "./automation-panel";
import { AutomationRunDialog } from "./automation-run-dialog";
import { AutomationTable } from "./automation-table";
import { AUTOMATION_TABS } from "./use-automation-selection";
import { useAutomationsPage } from "./use-automations-page";

import type { AutomationPageData } from "@/definition/AutomationPage";
import type { AutomationTab } from "./use-automation-selection";
import type { AutomationsPageState } from "./use-automations-page";

interface AutomationsPageProps {
  readonly data: AutomationPageData;
}

function isTab(value: string): value is AutomationTab {
  return AUTOMATION_TABS.some((tab) => tab === value);
}

/** The tab labels with their counts; "Verlauf" has none. */
function useTabOptions(
  page: AutomationsPageState,
): { readonly value: string; readonly label: React.ReactNode }[] {
  const { t, i18n } = useTranslation();
  const numbers = new Intl.NumberFormat(i18n.language);
  return AUTOMATION_TABS.map((tab) => ({
    value: tab,
    label: (
      <>
        {t(`automations.tabs.${tab}`)}
        {tab === "history" ? null : (
          <span className="font-semibold tabular-nums">
            {numbers.format(page.selection.counts[tab])}
          </span>
        )}
      </>
    ),
  }));
}

/** The table and the panel, or the history over the full width. */
function AutomationsContent({
  page,
}: {
  readonly page: AutomationsPageState;
}): React.ReactElement {
  if (page.selection.tab === "history")
    return <AutomationHistoryTable page={page} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row">
      <AutomationTable page={page} />
      <AutomationPanel page={page} />
    </div>
  );
}

/**
 * The page "Automationen" (PAGE-297): jobs for agents, scripts and plans
 * that start at times, in intervals, on events or by hand.
 *
 * @remarks
 * Tabs filter the table; the panel beside it shows the selected automation
 * read only and turns into its editor. Below `lg` the panel replaces the
 * table as a view of its own. "Verlauf" lists the newest runs over the full
 * width; `?tab=history&run=<runId>` opens a run from a push notification.
 */
export function AutomationsPage(
  props: AutomationsPageProps,
): React.ReactElement {
  const { t } = useTranslation();
  const page = useAutomationsPage(props.data);
  const tabs = useTabOptions(page);

  function handleTabChange(value: string): void {
    if (!isTab(value)) return;
    page.editor.close();
    page.actions.dismissFailure();
    page.selection.setTab(value);
  }

  function handleCreate(): void {
    page.actions.dismissFailure();
    if (page.selection.tab === "history") page.selection.setTab("all");
    page.editor.startCreate();
  }

  return (
    <section className="pages-page-fill flex w-full flex-col">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("automations.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("automations.subtitle")}
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="size-4" aria-hidden="true" />
          {t("automations.create")}
        </Button>
      </header>
      <Tabs
        ariaLabel={t("automations.tabs.label")}
        className="mt-6 min-h-0 flex-1"
        listClassName="max-w-full overflow-x-auto"
        onValueChange={handleTabChange}
        tabs={tabs}
        value={page.selection.tab}
      >
        <TabsContent
          className="mt-6 flex min-h-0 flex-1 flex-col outline-none"
          value={page.selection.tab}
        >
          <AutomationsContent page={page} />
        </TabsContent>
      </Tabs>
      <AutomationRunDialog page={page} />
      <AutomationDeleteDialog page={page} />
    </section>
  );
}
