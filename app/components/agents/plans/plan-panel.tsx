import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Tabs, TabsContent } from "@/app/components/ui/tabs";
import { cn } from "@/app/lib/cn";

import { AgentSources, TaskSources } from "./plan-sources";
import { PlanGroupSources } from "./plan-group-sources";
import { PlanParameters } from "./plan-parameters";
import { PlanInspector } from "./plan-inspector";

import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { usePlanEditor } from "./use-plan-editor";

/** On desktop a collapsible picker floats over the right edge of the grid, which keeps its full width; small screens stack it below. */
export function PlanPanel(props: {
  readonly page: AgentPlanPage;
  readonly editor: ReturnType<typeof usePlanEditor>;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setOpen] = useState(true);
  const [tab, setTab] = useState("agents");
  const { editor } = props;
  const disabled =
    !editor.canEdit || editor.isPending || !editor.draft.workspaceId;
  return (
    <aside
      aria-label={t("plans.pickers")}
      className={cn(
        "mt-3 flex flex-col items-end gap-2 lg:absolute lg:top-2 lg:right-2 lg:z-20 lg:mt-0 lg:max-h-[calc(100%-1rem)]",
        isOpen && "lg:bottom-2 lg:w-[min(22rem,calc(100%-1rem))]",
      )}
    >
      <Button
        size="sm"
        variant="outline"
        aria-expanded={isOpen}
        aria-controls="plan-picker-panel"
        onClick={() => setOpen(!isOpen)}
      >
        {t(isOpen ? "plans.collapsePanel" : "plans.expandPanel")}
      </Button>
      <div
        id="plan-picker-panel"
        hidden={!isOpen}
        className="min-h-0 w-full flex-1 space-y-3 overflow-y-auto rounded-xl border border-border bg-surface p-3 lg:shadow-panel"
      >
        <Tabs
          value={tab}
          onValueChange={setTab}
          ariaLabel={t("plans.pickers")}
          tabs={[
            { value: "agents", label: t("plans.tabs.agents") },
            { value: "groups", label: t("plans.tabs.groups") },
            { value: "tickets", label: t("plans.tabs.tickets") },
            { value: "parameters", label: t("plans.tabs.parameters") },
          ]}
        >
          <TabsContent value="agents" className="pt-3">
            <AgentSources
              sources={editor.sources}
              graph={editor.graph}
              canEdit={!disabled}
            />
          </TabsContent>
          <TabsContent value="groups" className="pt-3">
            <PlanGroupSources
              draft={editor.draft}
              graph={editor.graph}
              disabled={disabled}
            />
          </TabsContent>
          <TabsContent value="tickets" className="pt-3">
            <TaskSources
              sources={editor.sources}
              graph={editor.graph}
              canEdit={!disabled}
            />
          </TabsContent>
          <TabsContent value="parameters" className="pt-3">
            <PlanParameters
              draft={editor.draft}
              graph={editor.graph}
              disabled={disabled}
              onChange={editor.setDraft}
            />
          </TabsContent>
        </Tabs>
        <PlanInspector
          draft={editor.draft}
          sources={editor.sources}
          workspaces={props.page.workspaces}
          graph={editor.graph}
          disabled={disabled}
        />
      </div>
    </aside>
  );
}
