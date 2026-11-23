import { useTranslation } from "react-i18next";

import { planStepSelection } from "@/definition/AgentPlanSelection";
import { cn } from "@/app/lib/cn";
import { isPlanTemplateNode } from "@/definition/AgentPlanNodeTemplate";

import { usePlanFlowContext } from "../plan-flow-context";
import { keepPlanControlKeys } from "../plan-flow-keys";
import { planFlowDots, PlanFlowPorts } from "../plan-flow-ports";
import { planNodeClass, PLAN_TYPE_COLORS } from "../plan-layout";
import { PlanNodeActions, PlanNodeEditButton } from "../plan-node-actions";
import { PlanNodeIcon } from "../plan-node-icon";
import { PlanNodeWarning } from "../plan-node-warning";
import { PLAN_NODE_ICON, PLAN_NODE_TEXT } from "../plan-node-text";

import type { AgentPlanNode } from "@/definition/AgentPlan";
import type { PlanFlowDots } from "../plan-flow-ports";

/**
 * The body of a card: 14 px inset, and 26 px at the top, so the rows begin
 * 12 px below the status marker that reaches 11 px into the body.
 */
export const PLAN_CARD_BODY =
  "flex flex-col gap-1.5 px-3.5 pt-[1.625rem] pb-3.5";

/** One port row of a card body: 32 px high, the rows 6 px apart. */
export const PLAN_CARD_ROW = "relative flex h-8 min-w-0 items-center";

/**
 * The footer of an agent, a script and a swarm: a 1 px line above 64 px, 12
 * px inset around fields 40 px high and 8 px apart. Each field keeps its own
 * 12 px corner and 1 px edge around its 28 px tile; the line takes the
 * status tone, the fields stay neutral.
 */
export const PLAN_CARD_FOOTER = cn(
  "grid h-[65px] shrink-0 items-center gap-2 border-t p-3",
  PLAN_TYPE_COLORS.line,
);

/**
 * A line across the card below the body, such as the hint of a decision: 36
 * px with a 1 px line above, 11 px muted text, centred.
 */
export const PLAN_CARD_HINT = cn(
  "flex min-h-9 shrink-0 flex-col items-center justify-center border-t px-3.5 py-2.5 text-center text-muted-foreground",
  PLAN_TYPE_COLORS.line,
  PLAN_NODE_TEXT.meta,
);

interface PlanCardProps {
  readonly node: AgentPlanNode;
  /** The node's name; it names the card, its handle and its menu. */
  readonly label: string;
  /** The name line of the header, in the type color or the status tone. */
  readonly title: string;
  /** The type line above the name, such as „Agent“. */
  readonly subtitle?: string;
  /** A state of the card itself, such as the status tone of a run, the dashed edge of a skipped node or a broken file. */
  readonly stateClass?: string;
  /** The status marker, centred on the lower edge of the header; only nodes that run have one. */
  readonly status?: React.ReactNode;
  /** Opens the existing node dialog from the edit button beside the menu. */
  readonly onEdit?: () => void;
  /** A node that will not run is dimmed while keeping its type colors. */
  readonly isDimmed?: boolean;
  /** The flow dots on the header edge; without it the node type decides them. */
  readonly flowDots?: PlanFlowDots;
  readonly children: React.ReactNode;
}

/**
 * The shared frame of every node card: 340 px wide by its node, a 12 px
 * corner, a 1 px edge in the type color without a shadow, and a calm surface.
 * @remarks
 * The 66 px header, 11 px round at the top, holds the icon tile, the type
 * line and the name in the type color, the edit button and the three-dot
 * menu; the marker on the header's lower edge names the run status. While a
 * run is shown, the state class of a card that runs, is done or failed
 * draws surface, edge, header, tile, name, value fields and dividers in the
 * status tone instead. Only the name moves the card; fields and menus keep
 * pointer and keys.
 */
export function PlanCard(props: PlanCardProps): React.ReactElement {
  const { graph, canEdit } = usePlanFlowContext();
  const { node } = props;
  const needsSelection =
    node.type === "agent" && planStepSelection(node) !== null;
  const nodeIssues = graph.issues.filter((issue) => issue.nodeId === node.id);
  const hasDestructiveIssue = needsSelection
    ? nodeIssues.some((issue) => issue.reason !== "agent")
    : nodeIssues.length > 0;
  const hasWideEdge = needsSelection && !hasDestructiveIssue;
  return (
    <article
      aria-label={props.label}
      data-plan-card={node.type}
      onKeyDown={keepPlanControlKeys}
      className={cn(
        "relative flex w-full flex-col rounded-lg border transition-shadow",
        planNodeClass(node.type),
        PLAN_TYPE_COLORS.cardEdge,
        PLAN_TYPE_COLORS.cardSurface,
        props.stateClass,
        props.isDimmed && "opacity-70",
        graph.selectedId === node.id &&
          "ring-2 ring-info ring-offset-2 ring-offset-surface",
        hasWideEdge && "border-2 border-primary",
      )}
    >
      <PlanCardHeader {...props} hasWideEdge={hasWideEdge} />
      <PlanFlowPorts
        node={node}
        graph={graph}
        canEdit={canEdit}
        dots={props.flowDots ?? planFlowDots(node)}
      />
      {props.children}
    </article>
  );
}

/**
 * The two columns of a card body: inputs on the left, outputs on the right,
 * 14 px apart.
 */
export function PlanCardColumns(props: {
  readonly inputs: React.ReactNode;
  readonly outputs: React.ReactNode;
  /** The accessible name of the group of ports, if the rows need one. */
  readonly label?: string;
}): React.ReactElement {
  return (
    <div
      role={props.label ? "group" : undefined}
      aria-label={props.label}
      data-plan-columns=""
      className="grid grid-cols-2 gap-x-3.5"
    >
      <div className="flex min-w-0 flex-col gap-1.5">{props.inputs}</div>
      <div className="flex min-w-0 flex-col gap-1.5">{props.outputs}</div>
    </div>
  );
}

/**
 * The header inside the card edge: its upper corners are the card's 12 px
 * corner less the edge, 11 px, or 10 px within the 2 px edge of a required
 * choice, so header and edge draw one line.
 */
function PlanCardHeader(
  props: PlanCardProps & { readonly hasWideEdge: boolean },
): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit, requestTemplate } = usePlanFlowContext();
  const { node } = props;
  return (
    <header
      className={cn(
        "relative flex h-[66px] shrink-0 items-center gap-2 px-3 pb-5",
        props.hasWideEdge ? "rounded-t-[10px]" : "rounded-t-[11px]",
        PLAN_TYPE_COLORS.header,
      )}
    >
      <span className="flex w-[4.25rem] shrink-0 items-center">
        <span
          className={cn(
            "flex size-[30px] items-center justify-center rounded-[9px]",
            PLAN_TYPE_COLORS.tile,
          )}
        >
          <PlanNodeIcon
            type={node.type}
            direction={node.type === "jump" ? node.direction : undefined}
            className={PLAN_NODE_ICON}
          />
        </span>
      </span>
      <button
        type="button"
        data-plan-handle={node.id}
        onClick={() => graph.select(node.id)}
        className={cn(
          "min-w-0 flex-1 rounded text-center focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          canEdit && "cursor-grab active:cursor-grabbing",
        )}
        aria-label={t("plans.selectNode", { name: props.label })}
        title={props.label}
      >
        {props.subtitle ? (
          <span
            className={cn(
              "block truncate font-medium text-muted-foreground",
              PLAN_NODE_TEXT.meta,
            )}
          >
            {props.subtitle}
          </span>
        ) : null}
        <span
          className={cn(
            "block truncate",
            PLAN_NODE_TEXT.title,
            PLAN_TYPE_COLORS.title,
          )}
        >
          {props.title}
        </span>
      </button>
      <span className="flex min-w-[4.25rem] shrink-0 items-center justify-end">
        <PlanNodeWarning nodeId={node.id} issues={graph.issues} />
        {props.onEdit ? (
          <PlanNodeEditButton label={props.label} onEdit={props.onEdit} />
        ) : null}
        <span className="nodrag nopan">
          <PlanNodeActions
            label={props.label}
            disabled={!canEdit}
            onRemove={() => graph.remove(node.id)}
            onSaveTemplate={
              isPlanTemplateNode(node)
                ? () => requestTemplate(node.id)
                : undefined
            }
            size="card"
          />
        </span>
      </span>
      {props.status ? (
        <span className="absolute top-full left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1">
          {props.status}
        </span>
      ) : null}
    </header>
  );
}
