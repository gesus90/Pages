import { CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { planLoopOwner } from "@/definition/AgentPlanGroupLoop";
import { cn } from "@/app/lib/cn";
import { planLoopMembers, planLoopMode } from "@/definition/AgentPlanLoop";
import { isPlanLoopLeftRegularly } from "@/definition/AgentPlanLoopRun";

import { keepPlanControlKeys } from "./plan-flow-keys";
import {
  PLAN_FRAME_MARK,
  PlanFrameHeader,
  PlanFrameMemberArea,
} from "./plan-frame-header";
import { planNodeClass, planNodeLabel, PLAN_TYPE_COLORS } from "./plan-layout";
import { PlanLoopInputMark } from "./plan-loop-input";
import { PlanLoopPorts } from "./plan-loop-ports";
import { loopConditionText } from "./plan-loop-panel/loop-run-section";
import {
  planLoopProgress,
  planLoopRunOf,
  planLoopSummary,
} from "./plan-loop-summary";
import { PlanNodeActions, PlanNodeEditButton } from "./plan-node-actions";
import { PlanNodeWarning } from "./plan-node-warning";
import { PLAN_STATUS_MARKER, planStatusClass } from "./plan-status";

import type {
  AgentPlanInput,
  AgentPlanRun,
  AgentPlanSources,
  AgentPlanStepStatus,
} from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";
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
  const order = [...planLoopMembers(loop)].sort((first, second) =>
    first.x === second.x ? first.y - second.y : first.x - second.x,
  );
  return order
    .map((member) => planNodeLabel(member, sources))
    .filter(Boolean)
    .join(" → ");
}

/** The session rule of a loop: that of its group, or its own setting. */
function loopSessionText(
  props: LoopFrameProps,
  translate: (key: string) => string,
): string {
  if (planLoopOwner(props.draft, props.loop.id))
    return translate("plans.loops.session.inheritGroup");
  return translate(`plans.loops.session.${props.loop.sessionPolicy}Short`);
}

/** The latest verdict of the end condition during a run, if an iteration ran. */
function loopRunNote(
  props: LoopFrameProps,
  translate: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  const latest = planLoopRunOf(props.run, props.loop.id)?.iterations.at(-1);
  if (!latest) return null;
  return `${translate("plans.loops.run.iteration", { number: latest.number })} · ${loopConditionText(latest.condition, translate)}`;
}

/**
 * The container of a loop: a two-line header with its name, run state,
 * count input and marks, the dashed member area and the member count.
 * @remarks
 * The full settings are not drawn here; the pencil opens them in a floating
 * panel. The container is one flow node outwardly, with its dots on the
 * container edge at half the header height; its members are separate nodes
 * of the canvas placed in it. Surface and edge keep the loop color in every
 * state; the status marker names whether the loop was left regularly with a
 * confirmed cleanup, never after a single iteration, or failed.
 */
export function PlanLoopFrame(props: LoopFrameProps): React.ReactElement {
  const { t } = useTranslation();
  const { loop, graph } = props;
  const label = loop.name || t("plans.loops.defaultName");
  const record = planLoopRunOf(props.run, loop.id);
  const isLeft = props.run !== null && isPlanLoopLeftRegularly(record);
  return (
    <section
      data-plan-loop={loop.id}
      data-plan-loop-outcome={isLeft ? "succeeded" : undefined}
      aria-label={t("plans.loops.frame", { name: label })}
      onKeyDown={keepPlanControlKeys}
      className={cn(
        "relative size-full rounded-2xl border shadow-xs",
        planNodeClass("loop"),
        PLAN_TYPE_COLORS.frameEdge,
        PLAN_TYPE_COLORS.frameSurface,
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
      <PlanFrameHeader
        type="loop"
        id={loop.id}
        label={label}
        typeLine={t("plans.nodeType.loop")}
        canEdit={props.canEdit}
        onSelect={() => graph.select(loop.id)}
        handleLabel={t("plans.selectNode", { name: label })}
        actions={<LoopHeaderActions {...props} label={label} />}
        marks={<LoopMarks {...props} />}
        hasFlowLabels
      />
      <PlanFrameMemberArea
        emptyText={
          loop.steps.length === 0
            ? t(
                props.canEdit
                  ? "plans.loops.empty"
                  : "plans.loops.emptyReadOnly",
              )
            : undefined
        }
        footer={<LoopFooter {...props} />}
      />
    </section>
  );
}

/** The marks of the second header line: the count or while input, the count summary and the session rule. */
function LoopMarks(props: LoopFrameProps): React.ReactElement {
  const { t } = useTranslation();
  const { loop } = props;
  return (
    <>
      <PlanLoopInputMark {...props} />
      <span
        className={cn(PLAN_FRAME_MARK, "text-plan-loop")}
        title={
          planLoopMode(loop) === "while"
            ? t("plans.loops.whileTooltip")
            : t(`plans.loops.mode.${loop.countMode}Tooltip`)
        }
      >
        {planLoopSummary(props.draft, loop, t)}
      </span>
      <span className={cn(PLAN_FRAME_MARK, "text-plan-loop")}>
        {loopSessionText(props, t)}
      </span>
    </>
  );
}

function LoopHeaderActions(
  props: LoopFrameProps & { readonly label: string },
): React.ReactElement {
  const { loop, graph, label } = props;
  const record = planLoopRunOf(props.run, loop.id);
  return (
    <>
      <PlanLoopStatus loop={loop} record={record} run={props.run} />
      <PlanNodeWarning nodeId={loop.id} issues={graph.issues} />
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
        size="card"
      />
    </>
  );
}

/** The line below the member area: the member count, and the latest verdict during a run. */
function LoopFooter(props: LoopFrameProps): React.ReactElement {
  const { t } = useTranslation();
  const { loop } = props;
  const chain = memberChain(loop, props.sources);
  const note = loopRunNote(props, t);
  if (props.isDropTarget)
    return (
      <p role="status" className="shrink-0 font-medium text-plan-loop">
        {t("plans.loops.dropHere")}
      </p>
    );
  return (
    <p className="min-w-0 truncate text-center" title={chain || undefined}>
      {t("plans.loops.members", { count: planLoopMembers(loop).length })}
      {note ? ` · ${note}` : ""}
    </p>
  );
}

/** The marker colors of a loop's state: success only once it was left regularly. */
function loopStatusColors(
  status: AgentPlanStepStatus,
  isLeft: boolean,
): string {
  if (isLeft) return planStatusClass("succeeded");
  if (status === "succeeded") return planStatusClass("waiting");
  return planStatusClass(status);
}

function loopStatusKey(
  record: AgentPlanLoopRun | undefined,
  run: AgentPlanRun | null,
): string {
  const status = record?.status ?? "waiting";
  if (record?.completion && isPlanLoopLeftRegularly(record))
    return `plans.loops.completion.${record.completion}`;
  if (run === null || status === "waiting")
    return "plans.loops.status.notStarted";
  if (status === "succeeded") return "plans.loops.status.closing";
  return `plans.loops.status.${status}`;
}

/** The status marker of a loop, inline in the first header line. */
function PlanLoopStatus(props: {
  readonly loop: AgentPlanLoop;
  readonly record: AgentPlanLoopRun | undefined;
  readonly run: AgentPlanRun | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const { record } = props;
  const status = record?.status ?? "waiting";
  const isLeft = isPlanLoopLeftRegularly(record);
  const progress = planLoopProgress(record);
  const label = t(loopStatusKey(record, props.run));
  return (
    <span
      data-plan-loop-status={isLeft ? "left" : status}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 border",
        PLAN_STATUS_MARKER,
        loopStatusColors(status, isLeft),
      )}
      title={record?.error ? t(`settings.agents.error.${record.error}`) : label}
    >
      {isLeft ? (
        <CheckCircle2 aria-hidden="true" className="size-3 shrink-0" />
      ) : null}
      <span className="truncate">
        {progress && status !== "waiting" ? `${progress} · ${label}` : label}
      </span>
    </span>
  );
}
