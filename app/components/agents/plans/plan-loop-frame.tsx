import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { keepPlanControlKeys } from "./plan-flow-keys";
import { PLAN_FRAME_FOOTER, planNodeLabel } from "./plan-layout";
import { PlanLoopPorts } from "./plan-loop-ports";
import { loopConditionText } from "./plan-loop-panel/loop-run-section";
import { PlanLoopStatus } from "./plan-loop-status";
import { planLoopRunOf, planLoopSummary } from "./plan-loop-summary";
import { PlanNodeActions, PlanNodeEditButton } from "./plan-node-actions";
import { PlanNodeIcon } from "./plan-node-icon";
import { PLAN_NODE_TEXT } from "./plan-node-text";

import type {
  AgentPlanInput,
  AgentPlanRun,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { PlanGraphActions } from "./use-plan-graph";

interface LoopFrameProps {
  readonly loop: AgentPlanLoop;
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly isDropTarget: boolean;
  readonly run: AgentPlanRun | null;
  readonly onEdit?: (id: string) => void;
}

/** The names of the members in flow order, as far as the internal edges make one chain. */
function memberChain(loop: AgentPlanLoop, sources: AgentPlanSources): string {
  const order = [...loop.steps].sort((first, second) =>
    first.x === second.x ? first.y - second.y : first.x - second.x,
  );
  return order
    .map((member) => planNodeLabel(member, sources))
    .filter(Boolean)
    .join(" → ");
}

/**
 * The container of a loop: its name, count summary, run state and entry and exit ports.
 *
 * @remarks
 * The full settings are not drawn here; the pencil opens them in a floating
 * panel. The container is one flow node outwardly, with its dots on the
 * container edge; its members are separate nodes of the canvas placed in it.
 */
export function PlanLoopFrame(props: LoopFrameProps): React.ReactElement {
  const { t } = useTranslation();
  const { loop, graph } = props;
  const label = loop.name || t("plans.loops.defaultName");
  const hasIssue = graph.issues.some((issue) => issue.nodeId === loop.id);
  return (
    <section
      data-plan-loop={loop.id}
      aria-label={t("plans.loops.frame", { name: label })}
      onKeyDown={keepPlanControlKeys}
      className={cn(
        "relative size-full rounded-[1.25rem] border border-plan-loop-edge bg-plan-loop-subtle shadow-xs",
        props.isDropTarget && "ring-2 ring-plan-loop/40",
        graph.selectedId === loop.id &&
          "ring-2 ring-info ring-offset-2 ring-offset-background",
      )}
    >
      <PlanLoopPorts
        loopId={loop.id}
        label={label}
        graph={graph}
        canEdit={props.canEdit}
      />
      <div className="pointer-events-auto flex min-h-11 items-center gap-5 border-b border-plan-loop-edge/25 px-5 py-5">
        <LoopTitle {...props} label={label} hasIssue={hasIssue} />
        <LoopHeaderActions {...props} label={label} />
      </div>
      {loop.steps.length === 0 ? (
        <p
          className={cn(
            "absolute inset-x-5 top-28 text-muted-foreground",
            PLAN_NODE_TEXT.field,
          )}
        >
          {t(props.canEdit ? "plans.loops.empty" : "plans.loops.emptyReadOnly")}
        </p>
      ) : null}
      <LoopFooter {...props} />
    </section>
  );
}

function LoopTitle(
  props: LoopFrameProps & {
    readonly label: string;
    readonly hasIssue: boolean;
  },
): React.ReactElement {
  const { t } = useTranslation();
  const { loop, graph, label } = props;
  return (
    <button
      type="button"
      data-plan-handle={loop.id}
      onClick={() => graph.select(loop.id)}
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
          "mb-1 flex items-center gap-1 font-medium text-plan-loop",
          PLAN_NODE_TEXT.meta,
        )}
      >
        <PlanNodeIcon type="loop" className="size-3.5" />
        {t("plans.nodeType.loop")}
        {props.hasIssue ? (
          <TriangleAlert
            className="size-3.5 text-destructive"
            aria-label={t("plans.loops.needsRepair")}
          />
        ) : null}
      </span>
      <span className="block truncate">{label}</span>
    </button>
  );
}

function LoopHeaderActions(
  props: LoopFrameProps & { readonly label: string },
): React.ReactElement {
  const { t } = useTranslation();
  const { loop, graph, label } = props;
  const record = planLoopRunOf(props.run, loop.id);
  return (
    <>
      <span
        className={cn(
          "shrink-0 rounded-md border border-plan-loop/30 px-2 py-1.5 font-medium text-foreground",
          PLAN_NODE_TEXT.meta,
        )}
        title={t(`plans.loops.mode.${loop.countMode}Tooltip`)}
      >
        {planLoopSummary(props.draft, loop, t)}
      </span>
      <PlanLoopStatus loop={loop} record={record} run={props.run} />
      <div className="nodrag nopan flex shrink-0 items-center gap-2">
        <PlanNodeEditButton
          label={label}
          onEdit={() => {
            graph.select(loop.id);
            props.onEdit?.(loop.id);
          }}
        />
        <PlanNodeActions
          label={label}
          disabled={!props.canEdit}
          onRemove={() => graph.remove(loop.id)}
        />
      </div>
    </>
  );
}

/** The right side of the footer: the latest verdict of the end condition during a run, else the session setting. */
function footerNote(
  props: LoopFrameProps,
  translate: (key: string, options?: Record<string, unknown>) => string,
): string {
  const latest = planLoopRunOf(props.run, props.loop.id)?.iterations.at(-1);
  if (!latest)
    return translate(`plans.loops.session.${props.loop.sessionPolicy}Short`);
  return `${translate("plans.loops.run.iteration", { number: latest.number })} · ${loopConditionText(latest.condition, translate)}`;
}

function LoopFooter(props: LoopFrameProps): React.ReactElement {
  const { t } = useTranslation();
  const { loop } = props;
  const chain = memberChain(loop, props.sources);
  return (
    <div
      className={cn(
        "pointer-events-auto absolute inset-x-5 bottom-0 flex items-center justify-between gap-4 text-muted-foreground",
        PLAN_NODE_TEXT.meta,
      )}
      style={{ height: PLAN_FRAME_FOOTER }}
    >
      <p className="min-w-0 flex-1 truncate" title={chain}>
        {t("plans.loops.members", { count: loop.steps.length })}
        {chain ? ` · ${chain}` : ""}
      </p>
      {props.isDropTarget ? (
        <p role="status" className="shrink-0 font-medium text-plan-loop">
          {t("plans.loops.dropHere")}
        </p>
      ) : (
        <p
          className="min-w-0 max-w-[65%] truncate text-right"
          title={footerNote(props, t)}
        >
          {footerNote(props, t)}
        </p>
      )}
    </div>
  );
}
