import { useMemo, useState } from "react";

import {
  PLAN_PORT,
  planConditionSource,
} from "@/definition/AgentPlanBranching";
import {
  connectPlanBranching,
  setPlanDecisionCondition,
  setPlanDecisionInput,
} from "@/definition/AgentPlanBranchingEdit";
import { findPlanDecision } from "@/definition/AgentPlanDecisionEdit";
import { planConnectionIssues } from "@/definition/AgentPlanGraph";
import {
  bindPlanParameter,
  connectPlanFlow,
  findPlanBindingTarget,
  replacePlanNode,
} from "@/definition/AgentPlanGroupEdit";
import {
  PLAN_LOOP_RUNS_BINDING,
  PLAN_LOOP_WHILE_BINDING,
} from "@/definition/AgentPlanLoop";

import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { AgentPlanBranch } from "@/definition/AgentPlanBranching";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentPlanStackOutput } from "@/definition/AgentPlanStack";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { Dispatch, SetStateAction } from "react";

/**
 * The source half of a control, value, boolean-result, branch or predecessor-result connection.
 *
 * @remarks
 * `flow` is the control OUT of a node, `source` a value source, `result` the
 * text result of an agent or script, `passed` the boolean result of an agent
 * and `branch` one output of a decision.
 */
export type PlanConnection =
  | {
      readonly kind: "flow" | "source" | "result" | "passed";
      /** A node, or a boundary port of a frame for a source towards its members. */
      readonly nodeId: string;
    }
  | {
      readonly kind: "branch";
      readonly nodeId: string;
      /** The output of the decision the connection leaves through. */
      readonly branch: AgentPlanBranch;
    }
  | {
      /** One data output of a stack: the entry handed over last, or the number of entries. */
      readonly kind: "stack";
      readonly nodeId: string;
      readonly output: AgentPlanStackOutput;
    };

/** The plan with the new connection, or the issue that refuses it. */
type PlanConnectionAttempt =
  { readonly plan: AgentPlanInput } | { readonly issue: AgentPlanIssue };

/** What an attempt knows: the draft, the sources, the open connection and what the draft already has to complain about. */
interface PlanConnectionContext {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly connection: PlanConnection;
  /** The findings of the draft before the connection; asked once, only when a connection is checked. */
  readonly known: () => ReadonlySet<string>;
}

function issueKey(issue: AgentPlanIssue): string {
  return `${issue.nodeId ?? ""}|${issue.port ?? ""}|${issue.reason}`;
}

/** Remembers the findings of one draft, so that a connection is refused for what it adds only. */
function knownIssues(
  draft: AgentPlanInput,
  sources: AgentPlanSources,
): () => ReadonlySet<string> {
  let known: ReadonlySet<string> | null = null;
  return () => {
    known ??= new Set(
      planConnectionIssues(draft, sources.agents).map(issueKey),
    );
    return known;
  };
}

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
  context: PlanConnectionContext,
): PlanConnectionAttempt {
  // An unrelated finding of the draft, such as an event whose way back was cut, must not block a new connection.
  const known = context.known();
  const issue = planConnectionIssues(next, context.sources.agents).find(
    (entry) => !known.has(issueKey(entry)),
  );
  return issue ? { issue } : { plan: next };
}

function typeIssue(id: string, port: string): PlanConnectionAttempt {
  return { issue: { nodeId: id, port, reason: "type" } };
}

/**
 * A value into the data input of a decision: an agent's boolean result, a parameter, a ticket or a text result.
 *
 * @remarks
 * A decision reads one source; a connected input must be disconnected
 * before it reads another. Whether the source fits the decision's mode is
 * the plan check's: a boolean decision takes a boolean parameter or an
 * agent's boolean, a model decision a ticket or a text result (PAGE-286).
 */
function attemptCondition(
  context: PlanConnectionContext,
  id: string,
): PlanConnectionAttempt {
  const { draft, connection } = context;
  const decision = findPlanDecision(draft, id)?.decision;
  if (!decision) return typeIssue(id, PLAN_PORT.conditionIn);
  if (decision.input || planConditionSource(draft, id) !== null)
    return {
      issue: { nodeId: id, port: PLAN_PORT.conditionIn, reason: "duplicate" },
    };
  if (connection.kind === "passed")
    return checked(
      connectPlanBranching(draft, {
        kind: "condition",
        from: connection.nodeId,
        to: id,
      }),
      context,
    );
  const binding = connectionBinding(connection);
  if (binding?.kind !== "source" && binding?.kind !== "result")
    return typeIssue(id, PLAN_PORT.conditionIn);
  return checked(setPlanDecisionInput(draft, id, binding), context);
}

/**
 * The finding that refuses an agent as the condition of a decision, or `null`.
 *
 * @param draft - The plan as it is now.
 * @param sources - What the plan can use.
 * @param decisionId - The decision whose condition changes.
 * @param agentId - The agent to read; `null` clears the condition and is never refused.
 *
 * @remarks
 * The rules are those of a line drawn from the boolean result to the
 * condition, so the dialog and the canvas agree. Only what the change adds
 * counts: a plan that already has other findings can still be edited.
 */
export function planConditionRefusal(
  draft: AgentPlanInput,
  sources: AgentPlanSources,
  decisionId: string,
  agentId: string | null,
): AgentPlanIssue | null {
  if (agentId === null) return null;
  const known = knownIssues(draft, sources)();
  const next = setPlanDecisionCondition(draft, decisionId, agentId);
  return (
    planConnectionIssues(next, sources.agents).find(
      (issue) => !known.has(issueKey(issue)),
    ) ?? null
  );
}

/** The text result of an agent or script into the event input of an agent. */
function attemptEvent(
  context: PlanConnectionContext,
  id: string,
): PlanConnectionAttempt {
  const { draft, connection } = context;
  if (connection.kind !== "result") return typeIssue(id, PLAN_PORT.eventIn);
  return checked(
    connectPlanBranching(draft, {
      kind: "event",
      from: connection.nodeId,
      to: id,
    }),
    context,
  );
}

/** A control OUT, or an output of a decision, into a flow IN. */
function attemptFlow(
  context: PlanConnectionContext,
  id: string,
): PlanConnectionAttempt {
  const { draft, connection } = context;
  if (connection.kind === "branch")
    return checked(
      connectPlanBranching(draft, {
        kind: "branch",
        from: connection.nodeId,
        branch: connection.branch,
        to: id,
      }),
      context,
    );
  if (connection.kind !== "flow") return typeIssue(id, PLAN_PORT.flowIn);
  const next = connectPlanFlow(draft, connection.nodeId, id);
  return typeof next === "string"
    ? { issue: { nodeId: id, port: PLAN_PORT.flowIn, reason: next } }
    : checked(next, context);
}

/**
 * Applies the port rules of the server to one connection without changing the draft.
 *
 * @remarks
 * A data IN takes one binding; a connected IN must be disconnected before it
 * is bound again. `parameter` names a data input, or one of the branching
 * inputs `condition-in` and `event-in`, whose hyphen no parameter name has;
 * without it the connection ends at a flow IN.
 */
function attemptConnection(
  context: PlanConnectionContext,
  id: string,
  parameter?: string,
): PlanConnectionAttempt | null {
  const { draft, connection } = context;
  if (parameter === PLAN_PORT.conditionIn) return attemptCondition(context, id);
  if (parameter === PLAN_PORT.eventIn) return attemptEvent(context, id);
  if (parameter === undefined) return attemptFlow(context, id);
  const binding = connectionBinding(connection);
  if (!binding) return typeIssue(id, parameter);
  const loop = draft.nodes.find(
    (node): node is AgentPlanLoop => node.type === "loop" && node.id === id,
  );
  if (loop) return attemptLoopInput(context, loop, { parameter, binding });
  const bindings = targetBindings(draft, id);
  if (!bindings) return null;
  if (Object.hasOwn(bindings, parameter))
    return { issue: { nodeId: id, port: parameter, reason: "duplicate" } };
  return checked(bindPlanParameter(draft, id, parameter, binding), context);
}

/** The binding a data connection writes, or `null` for a connection that carries no value. */
function connectionBinding(
  connection: PlanConnection,
): AgentPlanBinding | null {
  if (connection.kind === "source")
    return { kind: "source", nodeId: connection.nodeId };
  if (connection.kind === "result")
    return { kind: "result", stepId: connection.nodeId };
  if (connection.kind === "stack")
    return {
      kind: "stack",
      stackId: connection.nodeId,
      output: connection.output,
    };
  return null;
}

/**
 * A value into an input of a loop: the count it runs, or the boolean of a while loop.
 *
 * @remarks
 * Binding the count switches the loop to a bound count, binding the boolean
 * to a while loop; the plan check then decides whether the source fits.
 */
function attemptLoopInput(
  context: PlanConnectionContext,
  loop: AgentPlanLoop,
  input: {
    readonly parameter: string;
    readonly binding: AgentPlanBinding;
  },
): PlanConnectionAttempt {
  const { parameter, binding } = input;
  const isRuns = parameter === PLAN_LOOP_RUNS_BINDING;
  if (!isRuns && parameter !== PLAN_LOOP_WHILE_BINDING)
    return typeIssue(loop.id, parameter);
  const fits = isRuns
    ? (binding.kind === "stack" && binding.output === "count") ||
      binding.kind === "source"
    : binding.kind === "source";
  if (!fits) return typeIssue(loop.id, parameter);
  const next: AgentPlanLoop = {
    ...loop,
    bindings: { ...loop.bindings, [parameter]: binding },
    ...(isRuns
      ? { mode: "count" as const, runsSource: "parameter" as const }
      : { mode: "while" as const }),
  };
  return checked(replacePlanNode(context.draft, next), context);
}

/** Answers whether the open connection may end at an IN, each IN checked once. */
function connectionVerdicts(context: {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly connection: PlanConnection | null;
}): (id: string, parameter?: string) => boolean {
  const { connection } = context;
  const answers = new Map<string, boolean>();
  // All INs of one draft share the findings the draft already has.
  const known = knownIssues(context.draft, context.sources);
  return (id, parameter) => {
    if (!connection) return false;
    const key = `${id}:${parameter ?? ""}`;
    const cached = answers.get(key);
    if (cached !== undefined) return cached;
    const result = attemptConnection(
      { ...context, connection, known },
      id,
      parameter,
    );
    const isAllowed = result !== null && "plan" in result;
    answers.set(key, isAllowed);
    return isAllowed;
  };
}

/** The context of one attempt on one draft. */
function attemptContext(
  draft: AgentPlanInput,
  sources: AgentPlanSources,
  connection: PlanConnection,
): PlanConnectionContext {
  return { draft, sources, connection, known: knownIssues(draft, sources) };
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
      attemptContext(draft, sources, source),
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
      attemptContext(currentDraft?.() ?? draft, sources, source),
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
        attemptContext(previous, sources, source),
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
