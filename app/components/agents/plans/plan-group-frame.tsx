import { Boxes, ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { planGroupAdapter } from "@/definition/AgentPlanGroup";
import { planGroupProgress } from "@/definition/AgentPlanGroupProgress";
import { cn } from "@/app/lib/cn";

import { PlanGroupAdapterBadge } from "./plan-group-adapter";
import { keepPlanControlKeys } from "./plan-flow-keys";
import { PLAN_FRAME_FOOTER } from "./plan-layout";
import { PlanGroupSessionValue } from "./plan-group-session";
import { PlanNodeActions, PlanNodeEditButton } from "./plan-node-actions";
import { PlanPaletteButton } from "./plan-palette-button";
import { PlanGroupCount, PlanGroupStatus } from "./plan-group-progress";
import { PlanGroupRoutes } from "./plan-group-routes";

import type { AgentPlanRun, AgentPlanSources } from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { PlanGroupSessionView } from "./plan-group-session";
import type { PlanGraphActions } from "./use-plan-graph";

interface GroupFrameProps {
  readonly group: AgentPlanGroup;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly isDropTarget: boolean;
  readonly session: PlanGroupSessionView;
  readonly run: AgentPlanRun | null;
  readonly runError?: string | null;
  readonly isCollapsed: boolean;
  readonly onToggle: () => void;
  readonly onEdit?: (id: string) => void;
}

function groupFrameClass(props: GroupFrameProps): string {
  return cn(
    "relative size-full border border-plan-group-edge bg-plan-group-subtle shadow-xs",
    props.isCollapsed ? "rounded-[0.875rem]" : "rounded-[1.25rem]",
    props.isDropTarget && "ring-2 ring-plan-group/40",
    props.graph.selectedId === props.group.id &&
      "ring-2 ring-info ring-offset-2 ring-offset-background",
  );
}

/** A portless yellow session container; collapsing changes only the canvas projection. */
export function PlanGroupFrame(props: GroupFrameProps): React.ReactElement {
  const { t } = useTranslation();
  const { group, graph, isCollapsed } = props;
  const label = group.name || t("plans.groups.defaultName");
  const progress = planGroupProgress(group, props.run, props.runError);
  const hasIssue = graph.issues.some((issue) => issue.nodeId === group.id);
  const adapter = planGroupAdapter(group, props.sources.agents);
  return (
    <section
      data-plan-group={group.id}
      data-collapsed={isCollapsed}
      aria-label={t("plans.groups.frame", { name: label })}
      onKeyDown={keepPlanControlKeys}
      className={groupFrameClass(props)}
    >
      <div
        className={cn(
          "pointer-events-auto",
          isCollapsed
            ? "px-4 pt-4 pb-2"
            : "border-b border-plan-group-edge/25 px-5 py-5",
        )}
      >
        <div
          className={cn(
            "flex items-center",
            isCollapsed ? "gap-3" : "min-h-11 gap-5",
          )}
        >
          <GroupHeaderContent {...props} label={label} />
          <PlanPaletteButton
            variant="outline"
            size="icon-sm"
            tooltip={t(
              isCollapsed ? "plans.groups.expand" : "plans.groups.collapse",
            )}
            aria-label={t(
              isCollapsed ? "plans.groups.expand" : "plans.groups.collapse",
            )}
            aria-expanded={!isCollapsed}
            onClick={(event) => {
              event.stopPropagation();
              props.onToggle();
            }}
            className="nodrag nopan grid size-8 shrink-0 place-items-center rounded-lg border-plan-group/40 bg-plan-group-subtle p-0 text-plan-group hover:bg-plan-group/10"
          >
            {isCollapsed ? (
              <ChevronRight className="size-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-4" aria-hidden="true" />
            )}
          </PlanPaletteButton>
        </div>
        {isCollapsed ? (
          <div className="mt-3 flex items-center justify-between gap-1">
            <PlanGroupAdapterBadge adapter={adapter} />
            <PlanGroupCount progress={progress} isCompact />
            <PlanGroupStatus progress={progress} isCompact />
          </div>
        ) : null}
        {hasIssue ? (
          <span className="sr-only">{t("plans.groups.needsRepair")}</span>
        ) : null}
      </div>
      {!isCollapsed ? <GroupFooter {...props} /> : null}
      {!isCollapsed && group.steps.length === 0 ? (
        <p className="absolute inset-x-5 top-28 text-sm text-muted-foreground">
          {t(
            props.canEdit ? "plans.groups.empty" : "plans.groups.emptyReadOnly",
          )}
        </p>
      ) : null}
      <PlanGroupRoutes group={group} isCollapsed={isCollapsed} />
    </section>
  );
}

function GroupHeaderContent(
  props: GroupFrameProps & { readonly label: string },
): React.ReactElement {
  const { t } = useTranslation();
  const { group, graph, label, isCollapsed } = props;
  const adapter = planGroupAdapter(group, props.sources.agents);
  const progress = planGroupProgress(group, props.run, props.runError);
  const needsRepair = graph.issues.some(
    (issue) =>
      issue.nodeId === group.id ||
      (issue.reason === "groupBinding" &&
        group.steps.some((step) => step.id === issue.nodeId)),
  );
  return (
    <>
      <button
        type="button"
        data-plan-handle={group.id}
        onClick={() => graph.select(group.id)}
        className={cn(
          "min-w-0 flex-1 rounded text-left text-sm font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          props.canEdit && "cursor-grab active:cursor-grabbing",
        )}
        aria-label={t("plans.selectNode", { name: label })}
        title={label}
      >
        <span className="mb-1 flex items-center gap-1 text-xs font-normal text-plan-group">
          <Boxes className="size-3" aria-hidden="true" />
          {t("plans.nodeType.group")}
          {needsRepair ? (
            <span
              title={t("plans.groups.needsRepair")}
              className="text-destructive"
            >
              <TriangleAlert
                className="size-3.5"
                aria-label={t("plans.groups.needsRepair")}
              />
            </span>
          ) : null}
        </span>
        <span className="block truncate">{label}</span>
      </button>
      {!isCollapsed ? (
        <>
          <PlanGroupAdapterBadge adapter={adapter} />
          <span className="rounded-md border border-plan-group/30 px-2 py-1.5">
            <PlanGroupStatus progress={progress} />
          </span>
          <PlanGroupCount progress={progress} isCompact={false} />
          <div className="nodrag nopan flex shrink-0 items-center gap-2 border-l border-plan-group/30 pl-4">
            <PlanNodeEditButton
              label={label}
              onEdit={() => {
                graph.select(group.id);
                props.onEdit?.(group.id);
              }}
            />
            <PlanNodeActions
              label={label}
              disabled={!props.canEdit}
              onRemove={() => graph.remove(group.id)}
            />
          </div>
        </>
      ) : null}
    </>
  );
}

function GroupFooter(props: GroupFrameProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div
      className="pointer-events-auto absolute inset-x-3 bottom-0 flex items-center gap-2"
      style={{ height: PLAN_FRAME_FOOTER }}
    >
      {props.runError ? (
        <p className="text-xs text-destructive">
          {t("plans.progress.unavailable")}
        </p>
      ) : (
        <PlanGroupSessionValue
          session={props.session}
          className="min-w-0 flex-1"
        />
      )}
      {props.isDropTarget ? (
        <p
          role="status"
          className="shrink-0 text-xs font-medium text-plan-group"
        >
          {t("plans.groups.dropHere")}
        </p>
      ) : null}
    </div>
  );
}
