import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react";
import { Boxes, ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { planGroupAdapter } from "@/definition/AgentPlanGroup";
import { planGroupContent } from "@/definition/AgentPlanGroupLoop";
import { planGroupProgress } from "@/definition/AgentPlanGroupProgress";
import { cn } from "@/app/lib/cn";

import { usePlanFlowContext } from "./plan-flow-context";
import { PlanGroupAdapterBadge } from "./plan-group-adapter";
import { keepPlanControlKeys } from "./plan-flow-keys";
import {
  PLAN_FRAME_MARK,
  PlanFrameHeader,
  PlanFrameMemberArea,
} from "./plan-frame-header";
import { planNodeClass, PLAN_TYPE_COLORS } from "./plan-layout";
import { planGroupRouteLinks } from "./plan-group-routing";
import { PlanGroupSessionValue } from "./plan-group-session";
import { planLinkKey, planLinkLabel } from "./plan-links";
import { PlanNodeActions, PlanNodeEditButton } from "./plan-node-actions";
import { PLAN_NODE_TEXT } from "./plan-node-text";
import { PlanPaletteButton } from "./plan-palette-button";
import {
  PlanGroupCount,
  PlanGroupStatus,
  planGroupToneClass,
} from "./plan-group-progress";
import { PlanNodeWarning } from "./plan-node-warning";
import { PLAN_STATUS_MARKER } from "./plan-status";

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
  /** Opens the dialog that saves the group with its members as a template. */
  readonly onSaveTemplate: (id: string) => void;
}

// A 16 px corner, collapsed as well, with a 1 px edge; while a run is shown
// the container takes the status tone of its state. Its members are nodes of
// their own and keep their own state.
function groupFrameClass(props: GroupFrameProps): string {
  const progress = planGroupProgress(props.group, props.run, props.runError);
  return cn(
    "relative size-full rounded-xl border shadow-xs",
    planNodeClass("group"),
    props.run !== null && planGroupToneClass(progress.state),
    PLAN_TYPE_COLORS.frameEdge,
    PLAN_TYPE_COLORS.frameSurface,
    props.isDropTarget && "ring-2 ring-plan-group/40",
    props.graph.selectedId === props.group.id &&
      "ring-2 ring-info ring-offset-2 ring-offset-background",
  );
}

/**
 * A portless session container with a two-line header, the dashed member
 * area and the member count; collapsing changes only the canvas projection.
 * @remarks
 * A group has no flow ports, so its second header line names no flow IN or
 * OUT; its middle shows the session mark and the runner of the group.
 */
export function PlanGroupFrame(props: GroupFrameProps): React.ReactElement {
  const { t } = useTranslation();
  const { group, graph, isCollapsed } = props;
  const label = group.name || t("plans.groups.defaultName");
  const hasIssue = graph.issues.some((issue) => issue.nodeId === group.id);
  const isEmpty = group.steps.length === 0 && !group.loops?.length;
  return (
    <section
      data-plan-group={group.id}
      data-collapsed={isCollapsed}
      aria-label={t("plans.groups.frame", { name: label })}
      onKeyDown={keepPlanControlKeys}
      className={groupFrameClass(props)}
    >
      {isCollapsed ? (
        <CollapsedGroupHeader {...props} label={label} />
      ) : (
        <>
          <PlanFrameHeader
            type="group"
            id={group.id}
            label={label}
            typeLine={<GroupTypeLine {...props} />}
            canEdit={props.canEdit}
            onSelect={() => graph.select(group.id)}
            handleLabel={t("plans.selectNode", { name: label })}
            actions={<GroupActions {...props} label={label} />}
            marks={<GroupMarks {...props} />}
            hasFlowLabels={false}
          />
          <PlanFrameMemberArea
            emptyText={
              isEmpty
                ? t(
                    props.canEdit
                      ? "plans.groups.empty"
                      : "plans.groups.emptyReadOnly",
                  )
                : undefined
            }
            footer={<GroupFooter {...props} />}
          />
        </>
      )}
      {hasIssue ? (
        <span className="sr-only">{t("plans.groups.needsRepair")}</span>
      ) : null}
      <PlanGroupRoutes group={group} isCollapsed={isCollapsed} />
    </section>
  );
}

/** The type line of a group, with the warning of a group that needs repair. */
function GroupTypeLine(props: GroupFrameProps): React.ReactElement {
  const { t } = useTranslation();
  const { group, graph } = props;
  const needsRepair = graph.issues.some(
    (issue) =>
      issue.nodeId === group.id ||
      (issue.reason === "groupBinding" &&
        group.steps.some((step) => step.id === issue.nodeId)),
  );
  return (
    <>
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
    </>
  );
}

/** The toggle that collapses or expands the group on the canvas. */
function GroupToggle(props: GroupFrameProps): React.ReactElement {
  const { t } = useTranslation();
  const label = t(
    props.isCollapsed ? "plans.groups.expand" : "plans.groups.collapse",
  );
  return (
    <PlanPaletteButton
      variant="outline"
      size="icon-sm"
      tooltip={label}
      aria-label={label}
      aria-expanded={!props.isCollapsed}
      onClick={(event) => {
        event.stopPropagation();
        props.onToggle();
      }}
      className="nodrag nopan grid size-7 min-h-7 shrink-0 place-items-center rounded-lg border-plan-group/40 bg-surface p-0 text-plan-group hover:bg-plan-group/10 xl:min-h-7"
    >
      {props.isCollapsed ? (
        <ChevronRight className="size-4" aria-hidden="true" />
      ) : (
        <ChevronDown className="size-4" aria-hidden="true" />
      )}
    </PlanPaletteButton>
  );
}

/** The right end of the first header line: status, progress, warning, toggle, edit button and menu. */
function GroupActions(
  props: GroupFrameProps & { readonly label: string },
): React.ReactElement {
  const { group, graph, label } = props;
  const progress = planGroupProgress(group, props.run, props.runError);
  return (
    <>
      <span
        className={cn(
          "inline-flex shrink-0 items-center border border-border bg-surface",
          PLAN_STATUS_MARKER,
        )}
      >
        <PlanGroupStatus progress={progress} />
      </span>
      <PlanGroupCount progress={progress} isCompact />
      <PlanNodeWarning nodeId={group.id} issues={graph.issues} />
      <GroupToggle {...props} />
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
        onSaveTemplate={() => props.onSaveTemplate(group.id)}
        size="card"
      />
    </>
  );
}

/** The marks of the second header line: the session of the shown run and the group's runner. */
function GroupMarks(props: GroupFrameProps): React.ReactElement {
  const { t } = useTranslation();
  const adapter = planGroupAdapter(props.group, props.sources.agents);
  return (
    <>
      {props.runError ? (
        <span className={cn(PLAN_FRAME_MARK, "text-destructive")}>
          {t("plans.progress.unavailable")}
        </span>
      ) : (
        <PlanGroupSessionValue
          session={props.session}
          className={cn(PLAN_FRAME_MARK, PLAN_TYPE_COLORS.title)}
        />
      )}
      <PlanGroupAdapterBadge adapter={adapter} />
    </>
  );
}

/** The header of a collapsed group: name, warning and toggle, then runner, progress and status. */
function CollapsedGroupHeader(
  props: GroupFrameProps & { readonly label: string },
): React.ReactElement {
  const { t } = useTranslation();
  const { group, graph, label } = props;
  const progress = planGroupProgress(group, props.run, props.runError);
  const adapter = planGroupAdapter(group, props.sources.agents);
  return (
    <div className="pointer-events-auto px-4 pt-4 pb-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          data-plan-handle={group.id}
          onClick={() => graph.select(group.id)}
          className={cn(
            "min-w-0 flex-1 rounded text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            PLAN_NODE_TEXT.title,
            props.canEdit && "cursor-grab active:cursor-grabbing",
          )}
          aria-label={t("plans.selectNode", { name: label })}
          title={label}
        >
          <span
            className={cn(
              "mb-1 flex items-center gap-1 font-medium",
              PLAN_TYPE_COLORS.title,
              PLAN_NODE_TEXT.meta,
            )}
          >
            <Boxes className="size-3" aria-hidden="true" />
            <GroupTypeLine {...props} />
          </span>
          <span className={cn("block truncate", PLAN_TYPE_COLORS.title)}>
            {label}
          </span>
        </button>
        <PlanNodeWarning nodeId={group.id} issues={graph.issues} />
        <GroupToggle {...props} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-1">
        <PlanGroupAdapterBadge adapter={adapter} />
        <PlanGroupCount progress={progress} isCompact />
        <PlanGroupStatus progress={progress} />
      </div>
    </div>
  );
}

/** The line below the member area: the member count, or where a dragged node lands. */
function GroupFooter(props: GroupFrameProps): React.ReactElement {
  const { t } = useTranslation();
  if (props.isDropTarget)
    return (
      <p role="status" className="shrink-0 font-medium text-plan-group">
        {t("plans.groups.dropHere")}
      </p>
    );
  return (
    <p className="min-w-0 truncate text-center">
      {t("plans.loops.members", {
        count: planGroupContent(props.group).length,
      })}
    </p>
  );
}

function PlanGroupRoutes({
  group,
  isCollapsed,
}: {
  readonly group: AgentPlanGroup;
  readonly isCollapsed: boolean;
}): React.ReactElement {
  const { draft, sources } = usePlanFlowContext();
  const update = useUpdateNodeInternals();
  const members = new Set(group.steps.map((step) => step.id));
  const links = isCollapsed ? planGroupRouteLinks(draft, group) : [];
  const signature = links.map(planLinkKey).join("|");
  useEffect(() => {
    update(group.id);
  }, [group.id, isCollapsed, signature, update]);
  return (
    <>
      {links.map((link) => {
        const isSource = members.has(link.from);
        const side = planGroupRouteLinks(
          draft,
          group,
          isSource ? "from" : "to",
        );
        const index = side.findIndex(
          (entry) => planLinkKey(entry) === planLinkKey(link),
        );
        return (
          <Handle
            key={`${planLinkKey(link)}:${isSource}`}
            id={`route:${planLinkKey(link)}:${isSource ? "from" : "to"}`}
            type={isSource ? "source" : "target"}
            position={isSource ? Position.Right : Position.Left}
            isConnectable={false}
            isConnectableStart={false}
            isConnectableEnd={false}
            aria-hidden="true"
            title={planLinkLabel(draft, sources, link)}
            style={{
              top: `${(100 * (index + 1)) / (side.length + 1)}%`,
              width: 1,
              height: 1,
              minWidth: 0,
              minHeight: 0,
              border: 0,
              background: "transparent",
              pointerEvents: "none",
            }}
          />
        );
      })}
    </>
  );
}
