import { useState } from "react";

import { planConnectionIssues } from "@/definition/AgentPlanGraph";
import {
  bindPlanParameter,
  connectPlanFlow,
  findPlanStep,
} from "@/definition/AgentPlanGroupEdit";

import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { Dispatch, SetStateAction } from "react";

interface PlanConnection {
  readonly kind: "flow" | "source" | "result";
  /** A node, or a boundary port of a frame for a source towards its members. */
  readonly nodeId: string;
}

/** The bindings of an agent node, inside a frame too, or of a frame's boundary. */
function targetBindings(
  draft: AgentPlanInput,
  id: string,
): Readonly<Record<string, AgentPlanBinding>> | null {
  const step = findPlanStep(draft, id)?.step;
  if (step) return step.bindings;
  const group = draft.nodes.find((node) => node.id === id);
  return group?.type === "group" ? group.bindings : null;
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
  function bind(
    targetId: string,
    parameter: string,
    binding: AgentPlanBinding,
  ): void {
    const bindings = targetBindings(draft, targetId);
    if (!bindings) return;
    if (Object.hasOwn(bindings, parameter)) {
      setIssue({ nodeId: targetId, port: parameter, reason: "duplicate" });
      return;
    }
    accept(bindPlanParameter(draft, targetId, parameter, binding));
  }
  function connect(id: string, parameter?: string): void {
    if (!connection) return;
    if (connection.kind === "flow" && parameter === undefined) {
      const next = connectPlanFlow(draft, connection.nodeId, id);
      if (next === "groupBoundary")
        setIssue({ nodeId: id, port: "flow-in", reason: "groupBoundary" });
      else accept(next);
      return;
    }
    if (connection.kind === "flow" || parameter === undefined) {
      setIssue({ nodeId: id, port: parameter ?? "flow-in", reason: "type" });
      return;
    }
    bind(
      id,
      parameter,
      connection.kind === "source"
        ? { kind: "source", nodeId: connection.nodeId }
        : { kind: "result", stepId: connection.nodeId },
    );
  }
  function bindSource(
    sourceId: string,
    targetId: string,
    parameter: string,
  ): void {
    bind(targetId, parameter, { kind: "source", nodeId: sourceId });
  }
  return { connection, connectionIssue, begin, connect, bindSource };
}
