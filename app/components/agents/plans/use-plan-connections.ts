import { useMemo, useState } from "react";

import { planConnectionIssues } from "@/definition/AgentPlanGraph";
import {
  bindPlanParameter,
  connectPlanFlow,
  findPlanBindingTarget,
} from "@/definition/AgentPlanGroupEdit";

import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { Dispatch, SetStateAction } from "react";

/** The source half of a control, value or predecessor-result connection. */
export interface PlanConnection {
  readonly kind: "flow" | "source" | "result";
  /** A node, or a boundary port of a frame for a source towards its members. */
  readonly nodeId: string;
}

/** The plan with the new connection, or the issue that refuses it. */
type PlanConnectionAttempt =
  { readonly plan: AgentPlanInput } | { readonly issue: AgentPlanIssue };

/** The bindings of an agent node, inside a frame too, or of a script. */
function targetBindings(
  draft: AgentPlanInput,
  id: string,
): Readonly<Record<string, AgentPlanBinding>> | null {
  const target = findPlanBindingTarget(draft, id);
  return target && target.type !== "group" ? target.bindings : null;
}

function checked(
  next: AgentPlanInput,
  sources: AgentPlanSources,
): PlanConnectionAttempt {
  const issue = planConnectionIssues(next, sources.agents)[0];
  return issue ? { issue } : { plan: next };
}

/**
 * Applies the port rules of the server to one connection without changing the draft.
 *
 * @remarks
 * A data IN takes one binding; a connected IN must be disconnected before it
 * is bound again.
 */
function attemptConnection(
  context: {
    readonly draft: AgentPlanInput;
    readonly sources: AgentPlanSources;
    readonly connection: PlanConnection;
  },
  id: string,
  parameter?: string,
): PlanConnectionAttempt | null {
  const { draft, sources, connection } = context;
  if (connection.kind === "flow" && parameter === undefined) {
    const next = connectPlanFlow(draft, connection.nodeId, id);
    return typeof next === "string"
      ? { issue: { nodeId: id, port: "flow-in", reason: next } }
      : checked(next, sources);
  }
  if (connection.kind === "flow" || parameter === undefined)
    return {
      issue: { nodeId: id, port: parameter ?? "flow-in", reason: "type" },
    };
  const bindings = targetBindings(draft, id);
  if (!bindings) return null;
  if (Object.hasOwn(bindings, parameter))
    return { issue: { nodeId: id, port: parameter, reason: "duplicate" } };
  const binding: AgentPlanBinding =
    connection.kind === "source"
      ? { kind: "source", nodeId: connection.nodeId }
      : { kind: "result", stepId: connection.nodeId };
  return checked(bindPlanParameter(draft, id, parameter, binding), sources);
}

/** Answers whether the open connection may end at an IN, each IN checked once. */
function connectionVerdicts(context: {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly connection: PlanConnection | null;
}): (id: string, parameter?: string) => boolean {
  const { connection } = context;
  const known = new Map<string, boolean>();
  return (id, parameter) => {
    if (!connection) return false;
    const key = `${id}:${parameter ?? ""}`;
    const cached = known.get(key);
    if (cached !== undefined) return cached;
    const result = attemptConnection({ ...context, connection }, id, parameter);
    const isAllowed = result !== null && "plan" in result;
    known.set(key, isAllowed);
    return isAllowed;
  };
}

/** Uses the same port rules as the server; a connected IN must be disconnected before rebinding. */
export function usePlanConnections(
  draft: AgentPlanInput,
  setDraft: Dispatch<SetStateAction<AgentPlanInput>>,
  sources: AgentPlanSources,
  currentDraft?: () => AgentPlanInput,
): {
  readonly connection: PlanConnection | null;
  readonly connectionIssue: AgentPlanIssue | null;
  readonly begin: (connection: PlanConnection | null) => void;
  readonly connect: (id: string, parameter?: string) => void;
  /** Whether the open connection may end at this IN, without changing the draft. */
  readonly canConnect: (id: string, parameter?: string) => boolean;
  /** Checks explicit source and target ports without relying on a preceding state update. */
  readonly canConnectFrom: (
    source: PlanConnection,
    id: string,
    parameter?: string,
  ) => boolean;
  /** Applies the existing validation to a complete library connection event. */
  readonly connectFrom: (
    source: PlanConnection,
    id: string,
    parameter?: string,
  ) => void;
} {
  const [connection, setConnection] = useState<PlanConnection | null>(null);
  const [connectionIssue, setIssue] = useState<AgentPlanIssue | null>(null);
  // Every IN asks while a connection is dragged, on each pointer move; the
  // answers only change with the draft or the open connection.
  const canConnect = useMemo(
    () => connectionVerdicts({ draft, sources, connection }),
    [draft, sources, connection],
  );
  function begin(next: PlanConnection | null): void {
    setConnection(next);
    setIssue(null);
  }
  function connect(id: string, parameter?: string): void {
    if (connection) connectFrom(connection, id, parameter);
  }
  function canConnectFrom(
    source: PlanConnection,
    id: string,
    parameter?: string,
  ): boolean {
    const result = attemptConnection(
      { draft, sources, connection: source },
      id,
      parameter,
    );
    return result !== null && "plan" in result;
  }
  function connectFrom(
    source: PlanConnection,
    id: string,
    parameter?: string,
  ): void {
    const result = attemptConnection(
      { draft: currentDraft?.() ?? draft, sources, connection: source },
      id,
      parameter,
    );
    if (!result) return;
    if ("issue" in result) {
      setIssue(result.issue);
      return;
    }
    setIssue(null);
    setDraft((previous) => {
      const current = attemptConnection(
        { draft: previous, sources, connection: source },
        id,
        parameter,
      );
      return current && "plan" in current ? current.plan : previous;
    });
    setConnection(null);
  }
  return {
    connection,
    connectionIssue,
    begin,
    connect,
    canConnect,
    canConnectFrom,
    connectFrom,
  };
}
