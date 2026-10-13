import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Tabs, TabsContent } from "@/app/components/ui/tabs";

import { AgentSources, TaskSources } from "./plan-sources";
import { PlanParameters } from "./plan-parameters";
import { PlanInspector } from "./plan-inspector";

import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { usePlanEditor } from "./use-plan-editor";

/** A compact collapsible picker keeps the grid as the primary workspace. */
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
      className={isOpen ? "w-full shrink-0 space-y-3 lg:w-80" : "shrink-0"}
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
      <div id="plan-picker-panel" hidden={!isOpen} className="space-y-3">
        <Tabs
          value={tab}
          onValueChange={setTab}
          ariaLabel={t("plans.pickers")}
          tabs={[
            { value: "agents", label: t("plans.tabs.agents") },
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
