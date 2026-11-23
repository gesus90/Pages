import { useUpdateNodeInternals } from "@xyflow/react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import {
  planConditionSource,
  planReceivesEvents,
} from "@/definition/AgentPlanBranching";
import { planNodeParameters } from "@/definition/AgentPlanGroup";

import { usePlanFlowContext } from "./plan-flow-context";
import { PlanEndpoint } from "./plan-endpoint";
import { PlanGroupFrame } from "./plan-group-frame";
import { PlanLoopFrame } from "./plan-loop-frame";
import { planLoopMemberResult } from "./plan-loop-summary";
import { planRunGroupSession } from "./plan-group-session";
import { PLAN_TYPE_COLORS } from "./plan-layout";
import { PLAN_NODE_TEXT } from "./plan-node-text";
import { PlanAgentCard } from "./plan-node-card/plan-agent-card";
import { PlanCard, PLAN_CARD_BODY } from "./plan-node-card/plan-card";
import { PlanDecisionCard } from "./plan-node-card/plan-decision-card";
import { PlanGitCloseoutCard } from "./plan-node-card/plan-git-closeout-card";
import { PlanScriptCard } from "./plan-node-card/plan-script-card";
import { PlanStackCard } from "./plan-node-card/plan-stack-card";
import { PlanSwarmCard } from "./plan-swarm/plan-swarm-card";
import { PlanSourceCard } from "./plan-node-card/plan-source-card";
import { PlanAssetCard } from "./plan-node-card/plan-asset-card";
import { PlanJumpCard } from "./plan-jump/plan-jump-card";
import {
  planJumpPorts,
  planNodePortSignature,
} from "./plan-jump/plan-jump-model";
import { PlanPortGrid, planPortGridDots } from "./plan-jump/plan-jump-ports";
import { firstFilledText } from "./plan-jump/plan-jump-text";
import { PlanSignalRunLine } from "./plan-jump/plan-signal-run";
import { PlanRunMarker, planRunCardClass } from "./plan-status";

import type { NodeProps } from "@xyflow/react";
import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanRun,
  AgentPlanSources,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanSignal } from "@/definition/AgentPlanJump";
import type { PlanFlowNode } from "./plan-flow-model";

function nodeResult(
  run: AgentPlanRun | null,
  nodeId: string,
): AgentPlanStepResult | undefined {
  return (
    run?.steps.find((step) => step.id === nodeId) ??
    planLoopMemberResult(run, nodeId)
  );
}

/**
 * Custom React Flow cards retain the Pages instance, ports and recorded run states.
 * @remarks
 * One card family: start and end as compact pills, every other card 340 px
 * wide with the shared header and two port columns, as tall as its rows.
 * Loop and group are containers with a two-line header.
 */
export function PlanNodeCard({
  data: { node },
}: NodeProps<PlanFlowNode>): React.ReactElement {
  const context = usePlanFlowContext();
  const { sources, graph, canEdit, run } = context;
  const result = nodeResult(run, node.id);
  usePlanFlowPorts(node, sources, planPortLayout(context.draft, node, result));
  if (node.type === "start" || node.type === "end")
    return (
      <PlanEndpoint
        node={node}
        graph={graph}
        canEdit={canEdit}
        hasRun={run !== null}
        result={result}
      />
    );
  if (node.type === "group")
    return (
      <PlanGroupFrame
        {...context}
        group={node}
        isDropTarget={context.dropTarget === node.id}
        session={planRunGroupSession(run, node.id)}
        isCollapsed={context.collapsedGroups.has(node.id)}
        onToggle={() => context.toggleGroup(node.id)}
        onSaveTemplate={context.requestTemplate}
      />
    );
  if (node.type === "loop")
    return (
      <PlanLoopFrame
        {...context}
        loop={node}
        isDropTarget={context.dropTarget === node.id}
      />
    );
  if (node.type === "agent")
    return <PlanAgentCard step={node} result={result} hasRun={run !== null} />;
  if (node.type === "script")
    return (
      <PlanScriptCard script={node} result={result} hasRun={run !== null} />
    );
  if (node.type === "git_closeout")
    return (
      <PlanGitCloseoutCard
        closeout={node}
        result={result}
        hasRun={run !== null}
      />
    );
  if (node.type === "decision")
    return (
      <PlanDecisionCard decision={node} result={result} hasRun={run !== null} />
    );
  if (node.type === "stack")
    return (
      <PlanStackCard
        stack={node}
        hasRun={run !== null}
        isDropTarget={context.dropTarget === node.id}
      />
    );
  if (node.type === "jump")
    return <PlanJumpCard jump={node} result={result} hasRun={run !== null} />;
  if (node.type === "signal")
    return (
      <PlanSignalCard signal={node} result={result} hasRun={run !== null} />
    );
  if (node.type === "asset") return <PlanAssetCard node={node} />;
  if (node.type === "swarm")
    return <PlanSwarmCard swarm={node} result={result} hasRun={run !== null} />;
  return <PlanSourceCard node={node} />;
}

function planPortLayout(
  draft: AgentPlanInput,
  node: AgentPlanNode,
  result: AgentPlanStepResult | undefined,
): string {
  return JSON.stringify([
    planReceivesEvents(draft, node.id),
    planConditionSource(draft, node.id),
    result?.activation ?? 1,
    result?.passed ?? null,
    result?.trigger?.sources.length ?? 0,
    result?.condition !== undefined,
    node.type === "stack" ? node.entries.length : null,
    node.type === "loop" ? [node.mode ?? "count", node.runsSource] : null,
    planNodePortSignature(draft, node),
    result?.jump
      ? [result.jump.state, result.jump.handover, result.jump.hasSignal]
      : null,
  ]);
}

function usePlanFlowPorts(
  node: AgentPlanNode,
  sources: AgentPlanSources,
  layout: string,
): void {
  const update = useUpdateNodeInternals();
  const id = node.id;
  const ports = JSON.stringify({
    inputs: planNodeParameters(node, sources.agents).map((port) => port.name),
    layout,
  });
  useEffect(() => {
    update(id);
  }, [id, ports, update]);
}

/** The signal name as the first row of the input column: its label and its value field. */
function SignalNameRow(props: {
  readonly signalName: string;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="grid h-8 grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-1">
      <span
        className={cn("truncate text-muted-foreground", PLAN_NODE_TEXT.field)}
      >
        {t("plans.field.name")}
      </span>
      <span
        title={props.signalName}
        className={cn(
          "flex h-6 max-w-[6.5rem] min-w-0 items-center rounded-sm px-2 font-mono",
          PLAN_TYPE_COLORS.field,
          PLAN_NODE_TEXT.field,
        )}
      >
        <span className="truncate">{props.signalName}</span>
      </span>
    </div>
  );
}

function PlanSignalCard(props: {
  readonly signal: AgentPlanSignal;
  readonly result: AgentPlanStepResult | undefined;
  readonly hasRun: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { draft, graph, onEdit } = usePlanFlowContext();
  const { signal, result } = props;
  const label = firstFilledText(signal.name) || t("plans.signal.title");
  const ports = planJumpPorts(draft, signal);
  function edit(): void {
    graph.select(signal.id);
    onEdit?.(signal.id);
  }
  return (
    <PlanCard
      node={signal}
      label={label}
      title={t("plans.signal.title")}
      subtitle={t("plans.signal.caption")}
      stateClass={props.hasRun ? planRunCardClass(result) : undefined}
      status={<PlanRunMarker hasRun={props.hasRun} result={result} />}
      flowDots={planPortGridDots(ports, t)}
      onEdit={edit}
    >
      <div data-plan-signal={signal.id} className={PLAN_CARD_BODY}>
        {props.hasRun && result?.signal ? (
          <PlanSignalRunLine signal={result.signal} />
        ) : null}
        <PlanPortGrid
          nodeId={signal.id}
          label={label}
          ports={ports}
          bindings={signal.bindings}
          leadingInputs={<SignalNameRow signalName={signal.signalName} />}
        />
      </div>
    </PlanCard>
  );
}
