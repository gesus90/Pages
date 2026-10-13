import { useState } from "react";

import { planConnectionIssues } from "@/definition/AgentPlanGraph";

import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { Dispatch, SetStateAction } from "react";

interface PlanConnection {
  readonly kind: "flow" | "source" | "result";
  readonly nodeId: string;
}

function bindParameter(
  draft: AgentPlanInput,
  targetId: string,
  parameter: string,
  binding: AgentPlanBinding,
): AgentPlanInput {
  return {
    ...draft,
    nodes: draft.nodes.map((node) =>
      node.id === targetId && node.type === "agent"
        ? { ...node, bindings: { ...node.bindings, [parameter]: binding } }
        : node,
    ),
  };
}

/** Uses the same port rules as the server; a connected IN must be disconnected before rebinding. */
export function usePlanConnections(
  draft: AgentPlanInput,
  setDraft: Dispatch<SetStateAction<AgentPlanInput>>,
  sources: AgentPlanSources,
): {
  readonly connection: PlanConnection | null;
  readonly connectionIssue: AgentPlanIssue | null;
  readonly begin: (connection: PlanConnection | null) => void;
  readonly connect: (id: string, parameter?: string) => void;
  readonly bindSource: (
    sourceId: string,
    targetId: string,
    parameter: string,
  ) => void;
} {
  const [connection, setConnection] = useState<PlanConnection | null>(null);
  const [connectionIssue, setIssue] = useState<AgentPlanIssue | null>(null);
  function begin(next: PlanConnection | null): void {
    setConnection(next);
    setIssue(null);
  }
  function accept(next: AgentPlanInput): void {
    const issue = planConnectionIssues(next, sources.agents)[0] ?? null;
    setIssue(issue);
    if (!issue) {
      setDraft(next);
      setConnection(null);
    }
  }
  function connect(id: string, parameter?: string): void {
    if (!connection) return;
    if (connection.kind === "flow" && parameter === undefined) {
      accept({
        ...draft,
        edges: [
          ...draft.edges,
          {
            from: connection.nodeId,
            to: id,
            fromPort: "flow-out",
            toPort: "flow-in",
          },
        ],
      });
      return;
    }
    if (connection.kind === "flow" || parameter === undefined) {
      setIssue({ nodeId: id, port: parameter ?? "flow-in", reason: "type" });
      return;
    }
    const target = draft.nodes.find((node) => node.id === id);
    if (target?.type !== "agent") return;
    if (Object.hasOwn(target.bindings, parameter)) {
      setIssue({ nodeId: id, port: parameter, reason: "duplicate" });
      return;
    }
    const binding: AgentPlanBinding =
      connection.kind === "source"
        ? { kind: "source", nodeId: connection.nodeId }
        : { kind: "result", stepId: connection.nodeId };
    accept(bindParameter(draft, id, parameter, binding));
  }
  function bindSource(
    sourceId: string,
    targetId: string,
    parameter: string,
  ): void {
    const target = draft.nodes.find((node) => node.id === targetId);
    if (target?.type !== "agent") return;
    if (Object.hasOwn(target.bindings, parameter)) {
      setIssue({ nodeId: targetId, port: parameter, reason: "duplicate" });
      return;
    }
    accept(
      bindParameter(draft, targetId, parameter, {
        kind: "source",
        nodeId: sourceId,
      }),
    );
  }
  return { connection, connectionIssue, begin, connect, bindSource };
}
