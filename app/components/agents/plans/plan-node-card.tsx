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
import { PLAN_NODE_TEXT } from "./plan-node-text";
import { PlanAgentCard } from "./plan-node-card/plan-agent-card";
import { PlanCard } from "./plan-node-card/plan-card";
import { PlanDecisionCard } from "./plan-node-card/plan-decision-card";
import { PlanGitCloseoutCard } from "./plan-node-card/plan-git-closeout-card";
import { PlanScriptCard } from "./plan-node-card/plan-script-card";
import { PlanStackCard } from "./plan-node-card/plan-stack-card";
import { PlanSwarmCard } from "./plan-swarm/plan-swarm-card";
import { PlanSourceCard } from "./plan-node-card/plan-source-card";
import { PlanAssetCard } from "./plan-node-card/plan-asset-card";
import { PlanJumpCard, PlanRunBadge } from "./plan-jump/plan-jump-card";
import {
  planJumpPorts,
  planNodePortSignature,
} from "./plan-jump/plan-jump-model";
import { PlanPortGrid } from "./plan-jump/plan-jump-ports";
import { firstFilledText } from "./plan-jump/plan-jump-text";
import { PlanSignalRunLine } from "./plan-jump/plan-signal-run";
import { planRunCardClass } from "./plan-status";

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
 * One card family: compact start and end, parameter, ticket and decision
 * cards of medium size and agent and script cards as tall as their inputs.
 * Jump and signal cards are as tall as their ports. Frames keep their own
 * design.
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

function PlanSignalCard(props: {
  readonly signal: AgentPlanSignal;
  readonly result: AgentPlanStepResult | undefined;
  readonly hasRun: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { draft, graph, onEdit } = usePlanFlowContext();
  const { signal, result } = props;
  const label = firstFilledText(signal.name) || t("plans.signal.title");
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
      runClass={props.hasRun ? planRunCardClass(result) : undefined}
      status={<PlanRunBadge hasRun={props.hasRun} result={result} />}
      onEdit={edit}
    >
      <div
        data-plan-signal={signal.id}
        className="flex flex-col gap-1.5 px-3 pt-1 pb-2"
      >
        <p
          title={signal.signalName}
          className={cn(
            "truncate font-mono font-medium text-foreground",
            PLAN_NODE_TEXT.field,
          )}
        >
          {signal.signalName}
        </p>
        {props.hasRun && result?.signal ? (
          <PlanSignalRunLine signal={result.signal} />
        ) : null}
        <PlanPortGrid
          nodeId={signal.id}
          label={label}
          ports={planJumpPorts(draft, signal)}
          bindings={signal.bindings}
        />
      </div>
    </PlanCard>
  );
}
