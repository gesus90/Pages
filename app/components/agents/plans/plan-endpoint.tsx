import { Check, Clock, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { usePlanFlowContext } from "./plan-flow-context";
import { keepPlanControlKeys } from "./plan-flow-keys";
import { PlanFlowDot } from "./plan-flow-ports";
import { planNodeClass, PLAN_TYPE_COLORS } from "./plan-layout";
import { PlanNodeActions, PlanNodeEditButton } from "./plan-node-actions";
import { PlanNodeIcon } from "./plan-node-icon";
import { PlanNodeWarning } from "./plan-node-warning";
import { PLAN_NODE_TEXT } from "./plan-node-text";
import {
  planStatusClass,
  planStatusKey,
  planStatusTone,
  planToneClass,
} from "./plan-status";
import { planEndpointPorts } from "./plan-jump/plan-jump-model";
import { PlanPortGrid } from "./plan-jump/plan-jump-ports";
import { firstFilledText } from "./plan-jump/plan-jump-text";

import type {
  AgentPlanEnd,
  AgentPlanStart,
  AgentPlanStepResult,
  AgentPlanStepStatus,
} from "@/definition/AgentPlan";
import type { PlanGraphActions } from "./use-plan-graph";

interface PlanEndpointProps {
  readonly node: AgentPlanStart | AgentPlanEnd;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly hasRun: boolean;
  readonly result?: AgentPlanStepResult;
}

/** The name of a start or end: a start may carry its own, otherwise the type names it. */
function useEndpointLabel(node: AgentPlanStart | AgentPlanEnd): string {
  const { t } = useTranslation();
  const own = firstFilledText(node.type === "start" ? node.name : undefined);
  return own || t(`plans.nodeType.${node.type}`);
}

// The pill in a status tone: the surface SS and an edge of 55 % S; without a
// tone the neutral surface and border, the name in the foreground color.
const PILL_COLORS =
  "border-[color:var(--plan-edge,var(--color-border))] bg-[color:var(--plan-tone-subtle,var(--color-surface))]";
const PILL_NAME_COLOR =
  "text-[color:var(--plan-tone-text,var(--color-foreground))]";

// The status ring of the orb: 3 px of SS, then 2 px in S; paused, cancelled
// and skipped endpoints have no tone and take the muted color.
const ORB_RING =
  "ring-2 ring-offset-[3px] ring-[color:var(--plan-tone,var(--color-muted-foreground))] ring-offset-[color:var(--plan-tone-subtle,var(--color-surface))]";

/** The symbol of the status circle: a check when it succeeded, a cross when it failed, else a clock. */
function statusSymbol(
  status: AgentPlanStepStatus,
  isBlocked: boolean,
): typeof Check {
  if (isBlocked || status === "failed" || status === "cancelled") return X;
  return status === "succeeded" ? Check : Clock;
}

/** The ring of the orb in the status color; a waiting endpoint that nothing blocks has none. */
function orbRing(result: AgentPlanStepResult | undefined): string | false {
  const isWaiting = (result?.status ?? "waiting") === "waiting";
  return (!isWaiting || result?.isBlocked === true) && ORB_RING;
}

/** The status tone of the pill while a run is shown, in the mapping of the cards. */
function endpointToneClass(result: AgentPlanStepResult | undefined): string {
  return planToneClass(
    planStatusTone(result?.status ?? "waiting", result?.isBlocked === true),
  );
}

/** The run status as a 20 px circle with a 12 px symbol and its name for screen readers. */
function EndpointStatus(props: {
  readonly result: AgentPlanStepResult | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const status = props.result?.status ?? "waiting";
  const isBlocked = props.result?.isBlocked === true;
  const label = t(planStatusKey(status, isBlocked));
  const StatusIcon = statusSymbol(status, isBlocked);
  return (
    <span
      data-plan-endpoint-status={status}
      title={label}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border",
        planStatusClass(status, isBlocked),
      )}
    >
      <StatusIcon aria-hidden="true" className="size-3" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Start and end as pills: 170 by 56 px, the orb in the checkpoint color
 * left of the name, the run status and the menu at the right, and only
 * their legal flow dot, on the right of a start and the left of an end.
 * @remarks
 * The cards keep their stored coordinates. The orb only marks the node; it
 * starts nothing. While a run is shown, a ring in the status color surrounds
 * the orb, except while it waits; a running, done, failed or blocked pill
 * takes the status tone on its surface, edge, name and orb. A start that
 * other plans may call shows its accepted inputs as value outputs below the
 * pill, an end that returns values shows one value input per return, in the
 * rows of every card; a plan without them keeps the compact pill.
 */
export function PlanEndpoint(props: PlanEndpointProps): React.ReactElement {
  const { draft, onEdit } = usePlanFlowContext();
  const { node, graph } = props;
  const label = useEndpointLabel(node);
  const ports = planEndpointPorts(draft, node);
  function edit(): void {
    graph.select(node.id);
    onEdit?.(node.id);
  }
  return (
    <article
      aria-label={label}
      data-plan-endpoint={node.type}
      className={cn(
        "relative flex w-full flex-col gap-3",
        planNodeClass(node.type),
      )}
      onKeyDown={keepPlanControlKeys}
    >
      <div
        className={cn(
          "relative flex h-14 min-w-[170px] items-center gap-2 self-start rounded-[30px] border p-1.5 shadow-xs",
          props.hasRun && endpointToneClass(props.result),
          PILL_COLORS,
          graph.selectedId === node.id &&
            "ring-2 ring-info ring-offset-2 ring-offset-surface",
        )}
      >
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full",
            PLAN_TYPE_COLORS.tile,
            props.hasRun && orbRing(props.result),
          )}
        >
          <PlanNodeIcon type={node.type} className="size-5" />
        </span>
        <EndpointName {...props} label={label} />
        <PlanNodeWarning nodeId={node.id} issues={graph.issues} />
        {props.hasRun ? <EndpointStatus result={props.result} /> : null}
        <PlanNodeEditButton label={label} onEdit={edit} />
        <span className="nodrag nopan">
          <PlanNodeActions
            label={label}
            disabled={!props.canEdit}
            onRemove={() => graph.remove(node.id)}
            shouldFocusCanvasOnRemove
            size="card"
          />
        </span>
        <EndpointFlowPort {...props} />
      </div>
      {ports.length > 0 ? (
        <div className="rounded-xl border border-border bg-surface px-3.5 py-2 shadow-xs">
          <PlanPortGrid
            nodeId={node.id}
            label={label}
            ports={ports}
            bindings={node.type === "end" ? node.bindings : undefined}
          />
        </div>
      ) : null}
    </article>
  );
}

/** The name of the endpoint: the handle that selects and moves it. */
function EndpointName(
  props: PlanEndpointProps & { readonly label: string },
): React.ReactElement {
  const { t } = useTranslation();
  const { node, graph, label } = props;
  return (
    <button
      type="button"
      data-plan-handle={node.id}
      onClick={() => graph.select(node.id)}
      aria-label={t("plans.selectNode", { name: label })}
      title={label}
      className={cn(
        "flex min-w-0 flex-1 flex-col self-stretch justify-center rounded-full text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        PLAN_NODE_TEXT.title,
        PILL_NAME_COLOR,
        props.canEdit && "cursor-grab active:cursor-grabbing",
      )}
    >
      <span className="whitespace-nowrap">{label}</span>
      <EndpointCaption node={node} />
    </button>
  );
}

/** The line under the name of a start that other plans may call. */
function EndpointCaption(props: {
  readonly node: AgentPlanStart | AgentPlanEnd;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (props.node.type !== "start" || props.node.callable !== true) return null;
  return (
    <span
      className={cn(
        "whitespace-nowrap text-muted-foreground",
        PLAN_NODE_TEXT.meta,
      )}
    >
      {t("plans.entry.callableShort")}
    </span>
  );
}

/** The one flow dot of a pill, centred on its right edge for a start and its left edge for an end. */
function EndpointFlowPort(props: PlanEndpointProps): React.ReactElement {
  const { t } = useTranslation();
  const { node, graph } = props;
  const isStart = node.type === "start";
  const port = isStart ? "flow-out" : "flow-in";
  return (
    <PlanFlowDot
      nodeId={node.id}
      side={isStart ? "out" : "in"}
      label={t(isStart ? "plans.flowOut" : "plans.flowIn")}
      top="50%"
      edge={0}
      graph={graph}
      canEdit={props.canEdit}
      hasIssue={graph.issues.some(
        (issue) => issue.nodeId === node.id && issue.port === port,
      )}
    />
  );
}
