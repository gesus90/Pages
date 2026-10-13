import { useId } from "react";

import { PLAN_NODE_WIDTH, planOutputY } from "./plan-layout";

import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanSources,
} from "@/definition/AgentPlan";

interface DrawnEdge {
  readonly source: AgentPlanNode;
  readonly target: AgentPlanNode;
  readonly parameter: string | null;
}

function drawnEdges(plan: AgentPlanInput): readonly DrawnEdge[] {
  const edges: DrawnEdge[] = [];
  for (const edge of plan.edges) {
    const source = plan.nodes.find((node) => node.id === edge.from);
    const target = plan.nodes.find((node) => node.id === edge.to);
    if (source && target) edges.push({ source, target, parameter: null });
  }
  for (const target of plan.nodes) {
    if (target.type !== "agent") continue;
    for (const [parameter, binding] of Object.entries(target.bindings)) {
      if (binding.kind === "literal") continue;
      const id = binding.kind === "source" ? binding.nodeId : binding.stepId;
      const source = plan.nodes.find((node) => node.id === id);
      if (source) edges.push({ source, target, parameter });
    }
  }
  return edges;
}

/** Solid flow arrows and dashed input arrows keep execution and parameter wiring distinct. */
export function PlanEdges(props: {
  readonly plan: AgentPlanInput;
  readonly sources: AgentPlanSources;
}): React.ReactElement {
  const markerId = useId();
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full overflow-visible text-muted-foreground"
      aria-hidden="true"
    >
      <defs>
        <marker
          id={markerId}
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8" fill="currentColor" />
        </marker>
      </defs>
      {drawnEdges(props.plan).map((edge) => {
        const target = edge.target;
        const x1 = edge.source.x + PLAN_NODE_WIDTH;
        const y1 =
          edge.source.y +
          (edge.parameter === null
            ? 72
            : planOutputY(edge.source, props.sources));
        const x2 = edge.target.x;
        const parameterIndex =
          target.type === "agent"
            ? (props.sources.agents
                .find((agent) => agent.id === target.agentId)
                ?.configuration.parameters.findIndex(
                  (parameter) => parameter.name === edge.parameter,
                ) ?? 0)
            : 0;
        const y2 =
          edge.target.y +
          (edge.parameter === null
            ? 72
            : 104 + Math.max(0, parameterIndex) * 32);
        const bend = Math.max(40, Math.abs(x2 - x1) / 2);
        return (
          <g
            key={`${edge.source.id}:${edge.target.id}:${edge.parameter ?? "flow"}`}
          >
            <path
              d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray={edge.parameter === null ? undefined : "6 4"}
              markerEnd={`url(#${markerId})`}
            />
            {edge.parameter !== null ? (
              <text
                x={(x1 + x2) / 2}
                y={(y1 + y2) / 2 - 6}
                className="fill-current text-xs"
              >
                {edge.parameter}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
