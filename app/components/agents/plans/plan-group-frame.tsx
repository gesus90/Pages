import { ArrowRight, Boxes } from "lucide-react";
import { useTranslation } from "react-i18next";

import { planGroupAdapter } from "@/definition/AgentPlanGroup";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { PlanGroupAdapterBadge } from "./plan-group-adapter";
import { PlanFlowPorts } from "./plan-flow-ports";
import {
  PLAN_FRAME_FOOTER,
  PLAN_FRAME_PORT_HANDLE,
  PLAN_NODE_WIDTH,
  planNodeHeight,
  planNodeWidth,
} from "./plan-layout";
import { PlanGroupSessionValue } from "./plan-group-session";
import { PlanNodeActions } from "./plan-node-actions";
import { PlanPorts } from "./plan-ports";
import { PlanStatusBadge } from "./plan-status";

import type {
  AgentPlanSources,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { PlanGroupSessionView } from "./plan-group-session";
import type { PlanGraphActions } from "./use-plan-graph";

interface GroupFrameProps {
  readonly group: AgentPlanGroup;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  /** The frame receives the agent being dragged over it. */
  readonly isDropTarget: boolean;
  /** The group's shared session in the selected run. */
  readonly session: PlanGroupSessionView;
  readonly result?: AgentPlanStepResult;
  readonly onEdit?: (id: string) => void;
  /** Opens the member list of the group, from which a member's console opens. */
  readonly onOpen?: (id: string) => void;
}

/**
 * A group as a subflow: a calm green frame around its members, with the
 * group's own flow and boundary ports in its header.
 *
 * @remarks
 * Members are drawn by the grid on top of the frame. The frame's background
 * stays part of the grid, so dragging it pans and a press on it clears the
 * selection like a press on the empty grid.
 */
export function PlanGroupFrame(props: GroupFrameProps): React.ReactElement {
  const { t } = useTranslation();
  const { group, graph } = props;
  const label = group.name || t("plans.groups.defaultName");
  const hasIssue = graph.issues.some((issue) => issue.nodeId === group.id);
  return (
    <section
      aria-label={t("plans.groups.frame", { name: label })}
      className={cn(
        "absolute rounded-xl border border-plan-group/60 bg-plan-group-subtle/60",
        props.isDropTarget &&
          "border-plan-group bg-plan-group-subtle ring-2 ring-plan-group/40",
        graph.selectedId === group.id &&
          "ring-2 ring-info ring-offset-2 ring-offset-background",
        hasIssue && "border-destructive",
      )}
      style={{
        left: group.x,
        top: group.y,
        width: planNodeWidth(group),
        height: planNodeHeight(group, props.sources),
      }}
    >
      <div className="p-3">
        <FrameHeader {...props} label={label} />
        <PlanFlowPorts node={group} graph={graph} canEdit={props.canEdit} />
        <div style={{ width: PLAN_NODE_WIDTH - 24 }}>
          <PlanPorts
            node={group}
            label={label}
            parameters={group.parameters}
            graph={graph}
            canEdit={props.canEdit}
          />
        </div>
      </div>
      <PortHandles {...props} />
      <div
        className="absolute inset-x-3 bottom-0 flex items-center gap-2"
        style={{ height: PLAN_FRAME_FOOTER }}
      >
        <PlanGroupSessionValue
          session={props.session}
          className="min-w-0 flex-1"
        />
        {props.isDropTarget ? (
          <p
            role="status"
            className="shrink-0 text-xs font-medium text-plan-group"
          >
            {t("plans.groups.dropHere")}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function FrameHeader(
  props: GroupFrameProps & { readonly label: string },
): React.ReactElement {
  const { t } = useTranslation();
  const { group, graph } = props;
  function edit(): void {
    graph.select(group.id);
    props.onEdit?.(group.id);
  }
  return (
    <div className="mb-2 flex h-9 items-center gap-1">
      <button
        type="button"
        data-plan-handle={group.id}
        onClick={() => graph.select(group.id)}
        onDoubleClick={() => {
          graph.select(group.id);
          props.onOpen?.(group.id);
        }}
        className={cn(
          "h-9 min-w-0 flex-1 text-left text-sm font-semibold",
          props.canEdit && "cursor-grab active:cursor-grabbing",
        )}
        aria-label={t("plans.selectNode", { name: props.label })}
      >
        <span className="flex items-center gap-1 text-xs font-normal text-plan-group">
          <Boxes className="size-3" aria-hidden="true" />
          {t("plans.nodeType.group")}
        </span>
        <span className="block truncate">{props.label}</span>
      </button>
      <PlanGroupAdapterBadge
        adapter={planGroupAdapter(group, props.sources.agents)}
      />
      {props.result ? (
        <PlanStatusBadge
          compact
          status={props.result.status}
          isBlocked={props.result.isBlocked}
        />
      ) : null}
      <PlanNodeActions
        label={props.label}
        disabled={!props.canEdit}
        onRemove={() => graph.remove(group.id)}
        onEdit={edit}
      />
    </div>
  );
}

/** A handle per boundary port that hands its value on to a member. */
function PortHandles(props: GroupFrameProps): React.ReactElement {
  const { t } = useTranslation();
  const { group, graph } = props;
  return (
    <>
      {group.parameters.map((port, index) => (
        <Button
          key={port.id}
          size="icon-sm"
          variant="ghost"
          className="absolute size-7 cursor-crosshair text-plan-group"
          data-plan-out={port.id}
          data-plan-out-kind="source"
          style={{
            left: PLAN_FRAME_PORT_HANDLE - 14,
            top: 104 + index * 32 - 14,
          }}
          disabled={!props.canEdit}
          aria-label={t("plans.groups.portToMember", { name: port.name })}
          title={t("plans.groups.portToMember", { name: port.name })}
          onClick={() => graph.begin({ kind: "source", nodeId: port.id })}
        >
          <ArrowRight className="size-3" aria-hidden="true" />
        </Button>
      ))}
    </>
  );
}
