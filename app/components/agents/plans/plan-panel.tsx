import {
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  Unlink,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Tabs, TabsContent } from "@/app/components/ui/tabs";
import { cn } from "@/app/lib/cn";

import { AgentSources, EndpointSources, TaskSources } from "./plan-sources";
import { PlanGroupSources } from "./plan-group-sources";
import { PlanParameters } from "./plan-parameters";
import { PlanInspector } from "./plan-inspector";
import { planLinkLabel } from "./plan-links";

import type { AgentPlanPage, AgentPlanRun } from "@/definition/AgentPlan";
import type { usePlanEditor } from "./use-plan-editor";

interface PanelContentsProps {
  readonly page: AgentPlanPage;
  readonly editor: ReturnType<typeof usePlanEditor>;
  readonly run: AgentPlanRun | null;
}

function PlanSelectionDetails(props: PanelContentsProps): React.ReactElement {
  const { t } = useTranslation();
  const { editor } = props;
  const disabled =
    !editor.canEdit || editor.isPending || !editor.draft.workspaceId;
  const link = editor.graph.selectedLink;
  if (!link)
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
  const name = planLinkLabel(editor.draft, editor.sources, link);
  return (
    <section
      className="space-y-3 rounded-xl border border-info/30 bg-info-subtle/40 p-3"
      aria-label={t("plans.dependencies")}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-xs text-muted-foreground">
            {t(`plans.linkKind.${link.kind}`)}
          </p>
          <p className="text-sm font-semibold break-words">{name}</p>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("plans.clearSelection")}
          onClick={() => editor.graph.selectLink(null)}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => editor.graph.disconnect(link)}
      >
        <Unlink className="size-4" aria-hidden="true" />
        {t("plans.unlink")}
      </Button>
    </section>
  );
}

/** Source tabs remain available independently of the single inspector above them. */
function PlanPanelTabs({ editor }: PanelContentsProps): React.ReactElement {
  const { t } = useTranslation();
  const [tab, setTab] = useState("agents");
  const disabled =
    !editor.canEdit || editor.isPending || !editor.draft.workspaceId;
  return (
    <section
      className="space-y-3 border-t border-border pt-3"
      aria-label={t("plans.flow.insert")}
      aria-busy={editor.isLoadingSources || editor.graph.isInserting}
    >
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground">
        {t("plans.flow.insert")}
      </h2>
      {editor.isLoadingSources || editor.graph.isInserting ? (
        <p
          role="status"
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <LoaderCircle
            className="size-3.5 motion-safe:animate-spin"
            aria-hidden="true"
          />
          {t(
            editor.graph.isInserting
              ? "plans.flow.inserting"
              : "plans.flow.loadingSources",
          )}
        </p>
      ) : null}
      <EndpointSources graph={editor.graph} canEdit={!disabled} />
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
          <PlanParameters
            draft={editor.draft}
            graph={editor.graph}
            disabled={disabled}
            onChange={editor.setDraft}
          />
        </TabsContent>
        <TabsContent value="agents" className="space-y-3 pt-3">
          <AgentSources
            sources={editor.sources}
            graph={editor.graph}
            canEdit={!disabled}
          />
        </TabsContent>
        <TabsContent value="tickets" className="space-y-3 pt-3">
          <TaskSources
            sources={editor.sources}
            graph={editor.graph}
            canEdit={!disabled}
          />
        </TabsContent>
        <TabsContent value="groups" className="space-y-3 pt-3">
          <PlanGroupSources
            draft={editor.draft}
            sources={editor.sources}
            graph={editor.graph}
            disabled={disabled}
          />
        </TabsContent>
      </Tabs>
    </section>
  );
}

/** A collapsible side panel keeps one selection inspector beside the canvas and groups insertion sources. */
export function PlanPanel(
  props: PanelContentsProps & {
    readonly isOpen: boolean;
    readonly onOpenChange: (isOpen: boolean) => void;
    readonly className?: string;
  },
): React.ReactElement {
  const { t } = useTranslation();
  const { isOpen } = props;
  const Toggle = isOpen ? PanelRightClose : PanelRightOpen;
  return (
    <aside
      aria-label={t("plans.pickers")}
      className={cn("flex min-h-0 min-w-0 flex-col gap-2", props.className)}
    >
      <div className="flex items-center justify-between gap-2">
        {isOpen ? (
          <h2 className="text-sm font-semibold">{t("plans.flow.inspector")}</h2>
        ) : null}
        <Button
          size="icon-sm"
          variant="outline"
          className="shrink-0 bg-surface shadow-xs"
          aria-expanded={isOpen}
          aria-controls="plan-picker-panel"
          aria-label={t(isOpen ? "plans.collapsePanel" : "plans.expandPanel")}
          title={t(isOpen ? "plans.collapsePanel" : "plans.expandPanel")}
          onClick={() => props.onOpenChange(!isOpen)}
        >
          <Toggle className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div
        id="plan-picker-panel"
        hidden={!isOpen}
        className="max-h-[65dvh] min-h-0 flex-1 space-y-4 overflow-y-auto rounded-2xl border border-border bg-surface p-3 shadow-xs lg:max-h-none"
      >
        <PlanSelectionDetails {...props} />
        <PlanPanelTabs {...props} />
      </div>
    </aside>
  );
}
