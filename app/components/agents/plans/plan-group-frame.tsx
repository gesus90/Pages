import { Boxes } from "lucide-react";
import { useTranslation } from "react-i18next";

import { planGroupAdapter } from "@/definition/AgentPlanGroup";
import { cn } from "@/app/lib/cn";

import { PlanGroupAdapterBadge } from "./plan-group-adapter";
import { PlanFlowPorts } from "./plan-flow-ports";
import { keepPlanControlKeys } from "./plan-flow-keys";
import { PLAN_FRAME_FOOTER, PLAN_NODE_WIDTH } from "./plan-layout";
import { PlanGroupSessionValue } from "./plan-group-session";
import { PlanNodeActions } from "./plan-node-actions";
import { PlanPorts } from "./plan-ports";
import { PlanStatusBadge, planStatusClass } from "./plan-status";

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
  readonly hasRun?: boolean;
  readonly onEdit?: (id: string) => void;
  /** Opens the member list of the group, from which a member's console opens. */
  readonly onOpen?: (id: string) => void;
}

/**
 * A group as a subflow: a calm green frame around its members, with the
 * group's own flow and boundary ports in its header.
 *
 * @remarks
 * React Flow parents the members to the frame; the domain keeps their
 * coordinates relative to its member area. Only the header moves the frame.
 */
export function PlanGroupFrame(props: GroupFrameProps): React.ReactElement {
  const { t } = useTranslation();
  const { group, graph } = props;
  const label = group.name || t("plans.groups.defaultName");
  const hasIssue = graph.issues.some((issue) => issue.nodeId === group.id);
  return (
    <section
      aria-label={t("plans.groups.frame", { name: label })}
      onKeyDown={keepPlanControlKeys}
      className={cn(
        "relative size-full rounded-2xl border shadow-xs",
        props.hasRun
          ? planStatusClass(
              props.result?.status ?? "waiting",
              props.result?.isBlocked,
            )
          : "border-plan-group/60 bg-plan-group-subtle/60",
        props.isDropTarget && "ring-2 ring-plan-group/40",
        props.isDropTarget &&
          !props.hasRun &&
          "border-plan-group bg-plan-group-subtle",
        graph.selectedId === group.id &&
          "ring-2 ring-info ring-offset-2 ring-offset-background",
        hasIssue && "border-destructive",
      )}
    >
      <div className="pointer-events-auto p-3">
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
      <div
        className="pointer-events-auto absolute inset-x-3 bottom-0 flex items-center gap-2"
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
        className={cn(
          "h-9 min-w-0 flex-1 rounded text-left text-sm font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          props.canEdit && "cursor-grab active:cursor-grabbing",
        )}
        aria-label={t("plans.selectNode", { name: props.label })}
        title={props.label}
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
      {props.hasRun ? (
        <PlanStatusBadge
          compact
          status={props.result?.status ?? "waiting"}
          isBlocked={props.result?.isBlocked}
        />
      ) : null}
      <div className="nodrag nopan">
        <PlanNodeActions
          label={props.label}
          disabled={!props.canEdit}
          onRemove={() => graph.remove(group.id)}
          onEdit={edit}
        />
      </div>
    </div>
  );
}
