import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { usePlanFlowContext } from "../plan-flow-context";
import { keepPlanControlKeys } from "../plan-flow-keys";
import { planNodeAccent, planNodeClass } from "../plan-layout";
import { PlanNodeActions } from "../plan-node-actions";
import { PlanNodeIcon } from "../plan-node-icon";

import type { AgentPlanNode } from "@/definition/AgentPlan";

interface PlanCardProps {
  readonly node: AgentPlanNode;
  /** The node's name; it names the card, its handle and its menu. */
  readonly label: string;
  readonly title: string;
  /** A small line above the title, such as the node type of an agent. */
  readonly subtitle?: string;
  /** The status colors of a shown run; without them the card shows its type. */
  readonly runClass?: string;
  /** The recorded run status, beside the menu. */
  readonly status?: React.ReactNode;
  /** Opens the existing node dialog from the menu. */
  readonly onEdit?: () => void;
  readonly children: React.ReactNode;
}

/**
 * The shared frame of agent, parameter and ticket cards: a calm tint of the
 * node type, a title row and the three-dot menu inside the top right corner.
 *
 * @remarks
 * Only the title moves the card; fields and menus keep pointer and keys.
 */
export function PlanCard(props: PlanCardProps): React.ReactElement {
  const { graph } = usePlanFlowContext();
  const { node } = props;
  return (
    <article
      aria-label={props.label}
      onKeyDown={keepPlanControlKeys}
      className={cn(
        "flex w-full flex-col rounded-xl border shadow-xs transition-shadow",
        props.runClass ?? planNodeClass(node.type),
        graph.selectedId === node.id &&
          "ring-2 ring-info ring-offset-2 ring-offset-surface",
        graph.issues.some((issue) => issue.nodeId === node.id) &&
          "border-destructive",
      )}
    >
      <PlanCardHeader {...props} />
      {props.children}
    </article>
  );
}

function PlanCardHeader(props: PlanCardProps): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const { node } = props;
  return (
    <header
      className={cn(
        "flex shrink-0 items-center gap-2 pr-1.5 pl-3",
        props.subtitle ? "h-12" : "h-11",
      )}
    >
      <PlanNodeIcon
        type={node.type}
        className={cn(
          "size-4.5 shrink-0",
          !props.runClass && planNodeAccent(node.type),
        )}
      />
      <button
        type="button"
        data-plan-handle={node.id}
        onClick={() => graph.select(node.id)}
        className={cn(
          "min-w-0 flex-1 rounded text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          canEdit && "cursor-grab active:cursor-grabbing",
        )}
        aria-label={t("plans.selectNode", { name: props.label })}
        title={props.label}
      >
        {props.subtitle ? (
          <span className="block text-[11px] leading-4 font-medium text-muted-foreground">
            {props.subtitle}
          </span>
        ) : null}
        <span className="block truncate text-sm leading-5 font-semibold">
          {props.title}
        </span>
      </button>
      {props.status}
      <div className="nodrag nopan">
        <PlanNodeActions
          label={props.label}
          disabled={!canEdit}
          onRemove={() => graph.remove(node.id)}
          onEdit={props.onEdit}
        />
      </div>
    </header>
  );
}
