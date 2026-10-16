import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Tabs, TabsContent } from "@/app/components/ui/tabs";
import { cn } from "@/app/lib/cn";

import { AgentSources, TaskSources } from "./plan-sources";
import { PlanGroupSources } from "./plan-group-sources";
import { PlanParameters } from "./plan-parameters";
import { PlanInspector, selectedPlanNode } from "./plan-inspector";

import type {
  AgentPlanNode,
  AgentPlanPage,
  AgentPlanRun,
} from "@/definition/AgentPlan";
import type { usePlanEditor } from "./use-plan-editor";

type PlanPanelTab = "parameters" | "agents" | "tickets" | "groups";

// The tab that shows a selected node; start and end belong to no tab and show in the open one.
const NODE_TABS: Partial<Record<AgentPlanNode["type"], PlanPanelTab>> = {
  agent: "agents",
  group: "groups",
  task: "tickets",
  parameter: "parameters",
  variable: "parameters",
};

function isPanelTab(value: string): value is PlanPanelTab {
  return ["parameters", "agents", "tickets", "groups"].includes(value);
}

/**
 * Picks the open tab: a new selection opens its own tab, a tab chosen by hand
 * stays open for the selection it was chosen with.
 */
function usePanelTab(
  selectedTab: PlanPanelTab | null,
  selectedId: string | null,
): readonly [PlanPanelTab, (tab: string) => void] {
  const [choice, setChoice] = useState<{
    readonly tab: PlanPanelTab;
    readonly selection: string | null;
  }>({ tab: "agents", selection: null });
  const tab =
    choice.selection === selectedId || selectedTab === null
      ? choice.tab
      : selectedTab;
  function choose(next: string): void {
    if (isPanelTab(next)) setChoice({ tab: next, selection: selectedId });
  }
  return [tab, choose];
}

/** The tabs of the side panel, each with the details of a selected node of its kind. */
function PlanPanelTabs(props: {
  readonly page: AgentPlanPage;
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly run: AgentPlanRun | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const { editor } = props;
  const disabled =
    !editor.canEdit || editor.isPending || !editor.draft.workspaceId;
  const selected = selectedPlanNode(
    editor.draft,
    editor.graph.selectedId,
  )?.node;
  const selectedTab = selected ? (NODE_TABS[selected.type] ?? null) : null;
  const [tab, setTab] = usePanelTab(selectedTab, editor.graph.selectedId);
  function details(owner: PlanPanelTab): React.ReactElement | null {
    if (!selected || (selectedTab !== null && selectedTab !== owner))
      return null;
    return (
      <PlanInspector
        draft={editor.draft}
        sources={editor.sources}
        workspaces={props.page.workspaces}
        graph={editor.graph}
        disabled={disabled}
        run={props.run}
      />
    );
  }
  return (
    <>
      <Tabs
        value={tab}
        onValueChange={setTab}
        ariaLabel={t("plans.pickers")}
        tabs={[
          { value: "parameters", label: t("plans.tabs.parameters") },
          { value: "agents", label: t("plans.tabs.agents") },
          { value: "tickets", label: t("plans.tabs.tickets") },
          { value: "groups", label: t("plans.tabs.groups") },
        ]}
      >
        <TabsContent value="parameters" className="space-y-3 pt-3">
          {details("parameters")}
          <PlanParameters
            draft={editor.draft}
            graph={editor.graph}
            disabled={disabled}
            onChange={editor.setDraft}
          />
        </TabsContent>
        <TabsContent value="agents" className="space-y-3 pt-3">
          {details("agents")}
          <AgentSources
            sources={editor.sources}
            graph={editor.graph}
            canEdit={!disabled}
          />
        </TabsContent>
        <TabsContent value="tickets" className="space-y-3 pt-3">
          {details("tickets")}
          <TaskSources
            sources={editor.sources}
            graph={editor.graph}
            canEdit={!disabled}
          />
        </TabsContent>
        <TabsContent value="groups" className="space-y-3 pt-3">
          {details("groups")}
          <PlanGroupSources
            draft={editor.draft}
            sources={editor.sources}
            graph={editor.graph}
            disabled={disabled}
          />
        </TabsContent>
      </Tabs>
      {selected ? null : (
        <p className="pt-3 text-sm text-muted-foreground">
          {t("plans.inspectorHint")}
        </p>
      )}
    </>
  );
}

/**
 * The independent panel at the right edge: sources by kind and the details of the selected node.
 *
 * @remarks
 * The details of a selection open in the tab of its kind, above the sources of
 * that kind, so the panel never shows a second inspector on top of another.
 */
export function PlanPanel(props: {
  readonly page: AgentPlanPage;
  readonly editor: ReturnType<typeof usePlanEditor>;
  /** The selected run, whose group sessions the details show. */
  readonly run: AgentPlanRun | null;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly className?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { isOpen } = props;
  const Toggle = isOpen ? PanelRightClose : PanelRightOpen;
  return (
    <aside
      aria-label={t("plans.pickers")}
      className={cn("flex min-h-0 flex-col items-end gap-2", props.className)}
    >
      <Button
        size="icon-sm"
        variant="outline"
        className="bg-surface shadow-xs"
        aria-expanded={isOpen}
        aria-controls="plan-picker-panel"
        aria-label={t(isOpen ? "plans.collapsePanel" : "plans.expandPanel")}
        title={t(isOpen ? "plans.collapsePanel" : "plans.expandPanel")}
        onClick={() => props.onOpenChange(!isOpen)}
      >
        <Toggle className="size-4" aria-hidden="true" />
      </Button>
      <div
        id="plan-picker-panel"
        hidden={!isOpen}
        className="min-h-0 w-full flex-1 overflow-y-auto rounded-xl border border-border bg-surface/95 p-3 shadow-panel backdrop-blur xl:pb-16"
      >
        <PlanPanelTabs
          page={props.page}
          editor={props.editor}
          run={props.run}
        />
      </div>
    </aside>
  );
}
