import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { PLAN_JUMP_PORT } from "@/definition/AgentPlanJump";

import { usePlanFlowContext } from "../plan-flow-context";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { PlanCard } from "../plan-node-card/plan-card";
import { PlanStatusBadge, planRunCardClass } from "../plan-status";
import { PlanJumpRunLines } from "./plan-jump-run";
import {
  planJumpPorts,
  planJumpTargetProblem,
  unconnectedFailurePorts,
} from "./plan-jump-model";
import { PlanPortGrid } from "./plan-jump-ports";
import { firstFilledText, planJumpTimeoutText } from "./plan-jump-text";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentPlanJump,
  AgentPlanJumpIn,
  AgentPlanJumpOut,
} from "@/definition/AgentPlanJump";

/** The name of the entry or the call, which names the card, its handle and its menu. */
function useJumpLabel(jump: AgentPlanJump): string {
  const { t } = useTranslation();
  const title = t(`plans.jump.title.${jump.direction}`);
  if (jump.direction === "in") return `${title} · ${jump.name.trim()}`;
  const target = firstFilledText(jump.name, jump.target?.planName);
  return target ? `${title} · ${target}` : title;
}

/** What a call waits for and how long, in one short line. */
function useWaitLine(jump: AgentPlanJumpOut): string {
  const { t } = useTranslation();
  const timeout = planJumpTimeoutText(jump, t);
  const workspace = t(`plans.jump.workspaceShort.${jump.workspace}`);
  return [
    t(`plans.jump.wait.${jump.wait}`),
    ...(jump.wait === "signal" ? [jump.signalName ?? ""] : []),
    ...(timeout ? [timeout] : []),
    workspace,
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

/** The finding about the stored target, told on the card itself. */
function TargetProblem(props: {
  readonly jump: AgentPlanJumpOut;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { sources } = usePlanFlowContext();
  const problem = planJumpTargetProblem(props.jump, sources.callTargets);
  if (!problem) return null;
  return (
    <p
      role="status"
      data-plan-jump-problem={problem}
      className={cn(
        "flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive-subtle px-2 py-1 font-medium text-destructive",
        PLAN_NODE_TEXT.meta,
      )}
    >
      <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>{t(`plans.jump.problem.${problem}`)}</span>
    </p>
  );
}

/** The note that a failure or a timeout without a continuation fails the plan. */
function UnconnectedNote(props: {
  readonly jump: AgentPlanJumpOut;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { draft } = usePlanFlowContext();
  const ports = unconnectedFailurePorts(draft, props.jump);
  if (ports.length === 0) return null;
  return (
    <p
      data-plan-jump-unconnected=""
      className={cn(
        "flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning-subtle px-2 py-1 font-medium text-warning",
        PLAN_NODE_TEXT.meta,
      )}
    >
      <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>
        {t("plans.jump.unconnected", {
          ports: ports
            .map((port) =>
              t(
                port === PLAN_JUMP_PORT.errorOut
                  ? "plans.jump.port.error"
                  : "plans.jump.port.timeout",
              ),
            )
            .join(", "),
        })}
      </span>
    </p>
  );
}

/** The target and the wait of a calling Jump, in the words of the person who set them. */
function OutSummary(props: {
  readonly jump: AgentPlanJumpOut;
}): React.ReactElement {
  const { t } = useTranslation();
  const { jump } = props;
  const waitLine = useWaitLine(jump);
  const target = jump.target
    ? `${jump.target.planName} · ${jump.target.entryName}`
    : null;
  return (
    <div className="flex flex-col gap-0.5">
      <p
        title={target ?? undefined}
        className={cn(
          "truncate font-medium",
          PLAN_NODE_TEXT.field,
          target ? "text-foreground" : "text-destructive",
        )}
      >
        {target ?? t("plans.jump.noTarget")}
      </p>
      <p
        title={waitLine}
        className={cn("truncate text-muted-foreground", PLAN_NODE_TEXT.meta)}
      >
        {waitLine}
      </p>
    </div>
  );
}

/** Whether other plans may call a receiving entry. */
function InSummary(props: {
  readonly jump: AgentPlanJumpIn;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <p
      className={cn("truncate text-muted-foreground", PLAN_NODE_TEXT.meta)}
      data-plan-jump-enabled={String(props.jump.isEnabled)}
    >
      {t(
        props.jump.isEnabled
          ? "plans.jump.in.enabled"
          : "plans.jump.in.disabled",
      )}
    </p>
  );
}

/** The run status beside the menu of a card; nothing while no run is shown. */
export function PlanRunBadge(props: {
  readonly hasRun: boolean;
  readonly result: AgentPlanStepResult | undefined;
}): React.ReactElement | null {
  if (!props.hasRun) return null;
  return (
    <PlanStatusBadge
      compact
      status={props.result?.status ?? "waiting"}
      isBlocked={props.result?.isBlocked}
    />
  );
}

/** What a calling Jump shows above its ports: its target, a finding about it, and where its call stands in a run. */
function OutBody(props: {
  readonly jump: AgentPlanJumpOut;
  readonly result: AgentPlanStepResult | undefined;
  readonly hasRun: boolean;
}): React.ReactElement {
  const { run } = usePlanFlowContext();
  const { jump, result } = props;
  return (
    <>
      <OutSummary jump={jump} />
      <TargetProblem jump={jump} />
      {props.hasRun && result?.jump ? (
        <PlanJumpRunLines
          jump={result.jump}
          stepStatus={result.status}
          runStatus={run?.status}
        />
      ) : null}
    </>
  );
}

/** The small line above the title of a Jump: the name of an entry, or what a call does. */
function useJumpCaption(jump: AgentPlanJump): string {
  const { t } = useTranslation();
  if (jump.direction === "out") return t("plans.jump.caption.out");
  return firstFilledText(jump.name) || t("plans.jump.caption.in");
}

/**
 * The Jump node: a receiving entry of a new run, or the call of another plan.
 * @remarks
 * Its ports follow the stored configuration, never the run: a receiving Jump
 * has no flow input; a calling Jump shows one value input per declared input
 * of its target, its normal exit by what it waits for, always its failure
 * output, the timeout output only for a finite wait, and the run id and the
 * reason. The direction is told by the title and the arrow of the icon, never
 * by colour.
 */
export function PlanJumpCard(props: {
  readonly jump: AgentPlanJump;
  readonly result: AgentPlanStepResult | undefined;
  readonly hasRun: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { draft, graph, onEdit } = usePlanFlowContext();
  const { jump, result } = props;
  const label = useJumpLabel(jump);
  const caption = useJumpCaption(jump);
  function edit(): void {
    graph.select(jump.id);
    onEdit?.(jump.id);
  }
  return (
    <PlanCard
      node={jump}
      label={label}
      title={t(`plans.jump.title.${jump.direction}`)}
      subtitle={caption}
      runClass={props.hasRun ? planRunCardClass(result) : undefined}
      status={<PlanRunBadge hasRun={props.hasRun} result={result} />}
      onEdit={edit}
    >
      <div
        data-plan-jump={jump.direction}
        className="flex flex-col gap-1.5 px-3 pt-1 pb-2"
      >
        {jump.direction === "out" ? (
          <OutBody jump={jump} result={result} hasRun={props.hasRun} />
        ) : (
          <InSummary jump={jump} />
        )}
        <PlanPortGrid
          nodeId={jump.id}
          label={label}
          ports={planJumpPorts(draft, jump)}
          bindings={jump.direction === "out" ? jump.bindings : undefined}
        />
        {jump.direction === "out" ? <UnconnectedNote jump={jump} /> : null}
      </div>
    </PlanCard>
  );
}
