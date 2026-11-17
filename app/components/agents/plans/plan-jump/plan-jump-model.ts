import { PLAN_PORT } from "@/definition/AgentPlanBranching";
import {
  PLAN_JUMP_PORT,
  PLAN_SIGNAL_PAYLOAD_BINDING,
  hasPlanJumpTimeout,
  isPlanJumpOut,
  planEntryInputs,
  planEntryOutputPort,
  planJumpFailurePorts,
  planPortName,
  planReturnOutputPort,
} from "@/definition/AgentPlanJump";

import type {
  AgentParameterType,
  AgentParameterValue,
} from "@/definition/AgentParameters";
import type {
  AgentPlanBinding,
  AgentPlanEnd,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanSources,
  AgentPlanStart,
} from "@/definition/AgentPlan";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type {
  AgentPlanCallEntry,
  AgentPlanCallTarget,
  AgentPlanEntryInput,
  AgentPlanEntryReturn,
  AgentPlanJump,
  AgentPlanJumpIn,
  AgentPlanJumpOut,
  AgentPlanSignal,
} from "@/definition/AgentPlanJump";
import type { PlanHandleKind } from "../plan-flow-handle";
import type { PlanConnection } from "../use-plan-connections";

/** Why the target a Jump stored cannot be called as stored. */
export type PlanJumpTargetProblem =
  "jumpTarget" | "jumpEntry" | "jumpInterface";

/** A port of a Jump, a signal, a start or an end, as its stored configuration has it. */
export interface PlanPortSpec {
  /** The handle the lines of the port end at. */
  readonly id: string;
  readonly side: "in" | "out";
  readonly kind: PlanHandleKind;
  /** The key of a fixed name; a declared name has none. */
  readonly labelKey: string | null;
  /** The declared name, or the fallback name of a port that no longer exists. */
  readonly text: string;
  /** The binding a value input fills; absent for a flow input. */
  readonly parameter?: string;
  /** What a click on an output starts; absent for an input. */
  readonly connection?: PlanConnection;
  readonly isRequired: boolean;
  readonly type?: AgentParameterType;
  /** A line still ends here although the stored configuration no longer has this port. */
  readonly isInvalid: boolean;
}

/** The key of the label of the normal exit of a calling Jump, by what it waits for. */
function successLabelKey(node: AgentPlanJumpOut): string {
  return `plans.jump.port.out.${node.wait}`;
}

function flowIn(): PlanPortSpec {
  return {
    id: PLAN_PORT.flowIn,
    side: "in",
    kind: "flow",
    labelKey: "plans.flowInShort",
    text: "",
    isRequired: false,
    isInvalid: false,
  };
}

function flowOut(nodeId: string, labelKey: string): PlanPortSpec {
  return {
    id: PLAN_PORT.flowOut,
    side: "out",
    kind: "flow",
    labelKey,
    text: "",
    connection: { kind: "flow", nodeId },
    isRequired: false,
    isInvalid: false,
  };
}

function valueIn(input: AgentPlanEntryInput): PlanPortSpec {
  return {
    id: input.name,
    side: "in",
    kind: "data",
    labelKey: null,
    text: input.name,
    parameter: input.name,
    isRequired: input.isRequired && input.defaultValue === null,
    type: input.type,
    isInvalid: false,
  };
}

function valueOut(
  nodeId: string,
  port: string,
  declared: { readonly text: string; readonly type?: AgentParameterType },
): PlanPortSpec {
  return {
    id: port,
    side: "out",
    kind: "data",
    labelKey: null,
    text: declared.text,
    connection: { kind: "port", nodeId, port },
    isRequired: false,
    ...(declared.type ? { type: declared.type } : {}),
    isInvalid: false,
  };
}

function fixedOut(
  nodeId: string,
  port: string,
  fixed: { readonly labelKey: string; readonly kind: PlanHandleKind },
): PlanPortSpec {
  return {
    id: port,
    side: "out",
    kind: fixed.kind,
    labelKey: fixed.labelKey,
    text: "",
    connection: { kind: "port", nodeId, port },
    isRequired: false,
    isInvalid: false,
  };
}

function failureOut(
  node: AgentPlanJumpOut,
  port: typeof PLAN_PORT.errorOut | typeof PLAN_PORT.timeoutOut,
): PlanPortSpec {
  const isError = port === PLAN_PORT.errorOut;
  return {
    id: port,
    side: "out",
    kind: isError ? "error" : "timeout",
    labelKey: `plans.jump.port.${isError ? "error" : "timeout"}`,
    text: "",
    connection: {
      kind: "branch",
      nodeId: node.id,
      branch: isError ? "error" : "timeout",
    },
    isRequired: false,
    isInvalid: false,
  };
}

/** The value outputs a calling Jump hands on besides the run id and the reason: its returns, or the payload of a signal. */
function waitOutputs(node: AgentPlanJumpOut): readonly PlanPortSpec[] {
  if (node.wait === "signal")
    return [
      {
        ...fixedOut(node.id, PLAN_JUMP_PORT.payloadOut, {
          labelKey: "plans.jump.port.payload",
          kind: "signal",
        }),
        type: node.payloadType ?? "text",
      },
    ];
  if (node.wait !== "completion") return [];
  return node.returns.map((entry) =>
    valueOut(node.id, planReturnOutputPort(entry.name), {
      text: entry.name,
      type: entry.type,
    }),
  );
}

/** The ports of a calling Jump, in the order of the card. */
function outPorts(node: AgentPlanJumpOut): readonly PlanPortSpec[] {
  return [
    flowIn(),
    ...node.inputs.map(valueIn),
    flowOut(node.id, successLabelKey(node)),
    failureOut(node, PLAN_PORT.errorOut),
    ...(hasPlanJumpTimeout(node)
      ? [failureOut(node, PLAN_PORT.timeoutOut)]
      : []),
    fixedOut(node.id, PLAN_JUMP_PORT.runIdOut, {
      labelKey: "plans.jump.port.runId",
      kind: "data",
    }),
    fixedOut(node.id, PLAN_JUMP_PORT.reasonOut, {
      labelKey: "plans.jump.port.reason",
      kind: "data",
    }),
    ...waitOutputs(node),
  ];
}

/** The ports of a receiving Jump: no flow input, its flow output and one value output per accepted input. */
function inPorts(node: AgentPlanJumpIn): readonly PlanPortSpec[] {
  return [
    flowOut(node.id, "plans.flowOutShort"),
    ...node.inputs.map((input) =>
      valueOut(node.id, planEntryOutputPort(input.name), {
        text: input.name,
        type: input.type,
      }),
    ),
  ];
}

/** The value input of a signal that carries a payload, bound under the binding `payload`. */
function payloadIn(type: AgentParameterType): PlanPortSpec {
  return {
    id: PLAN_JUMP_PORT.payloadIn,
    side: "in",
    kind: "signal",
    labelKey: "plans.jump.port.payload",
    text: "",
    parameter: PLAN_SIGNAL_PAYLOAD_BINDING,
    isRequired: true,
    type,
    isInvalid: false,
  };
}

function signalPorts(node: AgentPlanSignal): readonly PlanPortSpec[] {
  return [
    flowIn(),
    ...(node.payloadType ? [payloadIn(node.payloadType)] : []),
    flowOut(node.id, "plans.flowOutShort"),
  ];
}

/** The bindings a node holds, or none. */
function nodeBindings(
  node: AgentPlanNode,
): Readonly<Record<string, AgentPlanBinding>> {
  return "bindings" in node ? (node.bindings ?? {}) : {};
}

/** The ports a stored configuration of a Jump or a signal has. */
function configuredPorts(
  node: AgentPlanJump | AgentPlanSignal,
): readonly PlanPortSpec[] {
  if (node.type === "signal") return signalPorts(node);
  return node.direction === "in" ? inPorts(node) : outPorts(node);
}

/** The handle a binding key of the node is drawn at, as the lines of the plan name it. */
function bindingHandle(node: AgentPlanNode, key: string): string {
  return node.type === "signal" ? PLAN_JUMP_PORT.payloadIn : key;
}

function orphanKind(id: string): PlanHandleKind {
  if (id === PLAN_JUMP_PORT.errorOut) return "error";
  if (id === PLAN_JUMP_PORT.timeoutOut) return "timeout";
  return id === PLAN_PORT.flowIn || id === PLAN_PORT.flowOut ? "flow" : "data";
}

function orphanLabelKey(id: string): string | null {
  if (id === PLAN_PORT.flowIn) return "plans.flowInShort";
  if (id === PLAN_PORT.flowOut) return "plans.flowOutShort";
  if (id === PLAN_JUMP_PORT.errorOut) return "plans.jump.port.error";
  return id === PLAN_JUMP_PORT.timeoutOut ? "plans.jump.port.timeout" : null;
}

function orphan(id: string, side: "in" | "out"): PlanPortSpec {
  return {
    id,
    side,
    kind: orphanKind(id),
    labelKey: orphanLabelKey(id),
    text: planPortDisplayName(id),
    isRequired: false,
    isInvalid: true,
  };
}

/**
 * The ports a line or a binding still uses although the stored configuration of the node no longer has them.
 * @remarks
 * A line is never removed when a direction, a wait or a target changes; it
 * keeps a visibly invalid port instead, so that nothing is rewired silently.
 */
function orphanPorts(
  draft: Pick<AgentPlanInput, "nodes" | "edges">,
  node: AgentPlanNode,
  valid: ReadonlySet<string>,
): readonly PlanPortSpec[] {
  const inputs = new Set<string>();
  const outputs = new Set<string>();
  for (const edge of draft.edges) {
    if (edge.to === node.id && !valid.has(edge.toPort)) inputs.add(edge.toPort);
    if (edge.from === node.id && !valid.has(edge.fromPort))
      outputs.add(edge.fromPort);
  }
  for (const key of Object.keys(nodeBindings(node))) {
    const handle = bindingHandle(node, key);
    if (!valid.has(handle)) inputs.add(handle);
  }
  for (const other of draft.nodes)
    for (const binding of Object.values(nodeBindings(other)))
      if (
        binding.kind === "port" &&
        binding.nodeId === node.id &&
        !valid.has(binding.port)
      )
        outputs.add(binding.port);
  return [
    ...[...inputs].map((id) => orphan(id, "in")),
    ...[...outputs].map((id) => orphan(id, "out")),
  ];
}

/**
 * Every port of a Jump or a signal: the stored configuration decides, never the state of a run.
 * @param draft - The plan, whose lines and bindings may still use a port that is gone.
 * @param node - A receiving or calling Jump, or a signal.
 */
export function planJumpPorts(
  draft: Pick<AgentPlanInput, "nodes" | "edges">,
  node: AgentPlanJump | AgentPlanSignal,
): readonly PlanPortSpec[] {
  const ports = configuredPorts(node);
  return [
    ...ports,
    ...orphanPorts(draft, node, new Set(ports.map((port) => port.id))),
  ];
}

/** The value outputs of a start: its accepted inputs while other plans may call it, and those a binding still reads. */
function startPorts(
  draft: Pick<AgentPlanInput, "nodes">,
  node: AgentPlanStart,
): readonly PlanPortSpec[] {
  const isRead = (port: string): boolean =>
    draft.nodes.some((other) =>
      Object.values(nodeBindings(other)).some(
        (binding) =>
          binding.kind === "port" &&
          binding.nodeId === node.id &&
          binding.port === port,
      ),
    );
  return planEntryInputs(node)
    .filter(
      (input) =>
        node.callable === true || isRead(planEntryOutputPort(input.name)),
    )
    .map((input) =>
      valueOut(node.id, planEntryOutputPort(input.name), {
        text: input.name,
        type: input.type,
      }),
    );
}

function endPorts(node: AgentPlanEnd): readonly PlanPortSpec[] {
  return (node.returns ?? []).map((entry) =>
    valueIn({ ...entry, isRequired: true, defaultValue: null }),
  );
}

/**
 * The value ports below the title row of a start or an end.
 * @remarks
 * Their flow port is part of the compact card itself. A start shows its
 * inputs only while it is callable; an input stays shown while a binding
 * still reads it.
 */
export function planEndpointPorts(
  draft: Pick<AgentPlanInput, "nodes">,
  node: AgentPlanStart | AgentPlanEnd,
): readonly PlanPortSpec[] {
  return node.type === "start" ? startPorts(draft, node) : endPorts(node);
}

/** The name of a port in a text that has no translation at hand: the declared name, or a short word for a fixed port. */
export function planPortDisplayName(port: string): string {
  const declared = planPortName(port, "entry") ?? planPortName(port, "return");
  if (declared !== null) return declared;
  return port.replace(/-(?:in|out)$/u, "");
}

/** Whether a click on an output has begun this very connection. */
export function isSamePlanConnection(
  first: PlanConnection | null | undefined,
  second: PlanConnection | undefined,
): boolean {
  if (!first || !second) return false;
  if (first.kind !== second.kind || first.nodeId !== second.nodeId)
    return false;
  if (first.kind === "branch" && second.kind === "branch")
    return first.branch === second.branch;
  if (first.kind === "port" && second.kind === "port")
    return first.port === second.port;
  return true;
}

/** The failure outputs of a calling Jump that no line leaves: a failure there fails the plan. */
export function unconnectedFailurePorts(
  draft: Pick<AgentPlanInput, "edges">,
  node: AgentPlanJumpOut,
): readonly string[] {
  return planJumpFailurePorts(node).filter(
    (port) =>
      !draft.edges.some(
        (edge) => edge.from === node.id && edge.fromPort === port,
      ),
  );
}

/** A stable key of a typed default value, so that two copies of one value compare equal. */
function valueKey(value: AgentParameterValue | null): string {
  if (value === null) return "";
  switch (value.type) {
    case "text":
      return `text:${value.text}`;
    case "number":
      return `number:${value.number}`;
    case "ticket":
      return `ticket:${value.ticketId}`;
    case "workspace":
      return `workspace:${value.workspaceId}`;
    case "wiki":
      return `wiki:${value.pageId}`;
    case "asset":
      return `asset:${value.assetId}`;
  }
}

function inputKey(input: AgentPlanEntryInput): string {
  return [
    input.name,
    input.type,
    input.isRequired,
    valueKey(input.defaultValue),
  ].join("\n");
}

function sortedKeys(keys: readonly string[]): readonly string[] {
  return [...keys].sort();
}

function sameKeys(
  first: readonly string[],
  second: readonly string[],
): boolean {
  const left = sortedKeys(first);
  const right = sortedKeys(second);
  return (
    left.length === right.length &&
    left.every((key, index) => key === right[index])
  );
}

/** Whether the inputs and the returns a Jump stored are those the entry has now. */
export function isStoredInterfaceCurrent(
  node: Pick<AgentPlanJumpOut, "inputs" | "returns">,
  entry: Pick<AgentPlanCallEntry, "inputs" | "returns">,
): boolean {
  const returnKey = (value: AgentPlanEntryReturn): string =>
    `${value.name}\n${value.type}`;
  return (
    sameKeys(node.inputs.map(inputKey), entry.inputs.map(inputKey)) &&
    sameKeys(node.returns.map(returnKey), entry.returns.map(returnKey))
  );
}

/** The plan and the entry a Jump names, as the person may call them now. */
export function currentCallEntry(
  node: Pick<AgentPlanJumpOut, "target">,
  targets: readonly AgentPlanCallTarget[] | undefined,
): {
  readonly target: AgentPlanCallTarget;
  readonly entry: AgentPlanCallEntry;
} | null {
  const named = node.target;
  if (!named) return null;
  const target = targets?.find((entry) => entry.planId === named.planId);
  const entry = target?.entries.find(
    (candidate) => candidate.entryNodeId === named.entryNodeId,
  );
  return target && entry ? { target, entry } : null;
}

/**
 * What is wrong with the target a calling Jump stored, compared with what may be called now.
 * @param node - The calling Jump with its stored mirror of the target.
 * @param targets - The plans the person may call now; `undefined` while they are not known.
 * @returns The finding, or `null` for a target that is as stored, one that is
 * not chosen yet (the graph check reports that) or while the list is unknown.
 */
export function planJumpTargetProblem(
  node: AgentPlanJumpOut,
  targets: readonly AgentPlanCallTarget[] | undefined,
): PlanJumpTargetProblem | null {
  if (!node.target || targets === undefined) return null;
  const named = node.target;
  if (!targets.some((entry) => entry.planId === named.planId))
    return "jumpTarget";
  const current = currentCallEntry(node, targets);
  if (!current || current.entry.hasReturnConflict) return "jumpEntry";
  return isStoredInterfaceCurrent(node, current.entry) ? null : "jumpInterface";
}

/** The findings about the targets of all calling Jumps of a plan, for the nodes and ports of the canvas. */
export function planJumpTargetIssues(
  plan: Pick<AgentPlanInput, "nodes">,
  sources: Pick<AgentPlanSources, "callTargets">,
): readonly AgentPlanIssue[] {
  return plan.nodes.flatMap((node): AgentPlanIssue[] => {
    if (!isPlanJumpOut(node)) return [];
    const reason = planJumpTargetProblem(node, sources.callTargets);
    return reason ? [{ nodeId: node.id, port: null, reason }] : [];
  });
}

/**
 * A text that differs whenever a port of the node appears or goes, so that its lines are measured again.
 * @param draft - The plan, whose lines and bindings may still use a port that is gone.
 * @param node - Any node of the plan.
 */
export function planNodePortSignature(
  draft: Pick<AgentPlanInput, "nodes" | "edges">,
  node: AgentPlanNode,
): string | null {
  if (node.type === "jump" || node.type === "signal")
    return planJumpPorts(draft, node)
      .map((port) => `${port.side}:${port.id}`)
      .join("|");
  if (node.type === "start" || node.type === "end")
    return planEndpointPorts(draft, node)
      .map((port) => port.id)
      .join("|");
  return null;
}
