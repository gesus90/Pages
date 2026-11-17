import { z } from "zod";

import { isAgentParameterName } from "./AgentParameters";
import { PLAN_PORT } from "./AgentPlanBranching";
import { planContainedNodes } from "./AgentPlanGroupLoop";
import { hasPlanPath } from "./AgentPlanPath";

import type {
  AgentParameterType,
  AgentParameterValue,
} from "./AgentParameters";
import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanEnd,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanStart,
} from "./AgentPlan";
import type { AgentPlanIssue } from "./AgentPlanGraph";

/** The longest display name of a Jump entry. */
export const PLAN_JUMP_NAME_LENGTH = 120;
/** The most declared inputs, or returns, one entry holds. */
export const PLAN_JUMP_VALUE_COUNT = 16;
/** The longest signal name. */
export const PLAN_JUMP_SIGNAL_LENGTH = 64;
/** The wait of a Jump that waits, in minutes, unless the plan says otherwise. */
export const PLAN_JUMP_DEFAULT_MINUTES = 60;
/** The longest finite wait of a Jump: 30 days. */
export const PLAN_JUMP_MAX_MINUTES = 43_200;

/**
 * Which side of a call a Jump node stands on.
 * @remarks
 * `in` receives a call and starts a new run of its plan; `out` calls another
 * plan at one explicitly chosen entry. The direction is stored, never derived.
 */
export type AgentPlanJumpDirection = "in" | "out";

/**
 * What an outgoing Jump waits for before it goes on.
 * @remarks
 * `continue` goes on once the call is durably accepted, which neither means
 * that the target has started nor that it succeeded. `completion` waits for the
 * exact target run to end successfully with its cleanup confirmed. `signal`
 * waits for the named signal of this call, which says nothing about the end of
 * the target.
 */
export type AgentPlanJumpWait = "continue" | "completion" | "signal";

/** Whether the target works in its own workspace or takes over the one of the calling plan. */
export type AgentPlanJumpWorkspace = "own" | "shared";

/** How long a waiting Jump waits, counted from the durable acceptance of the call. */
export type AgentPlanJumpTimeout =
  | { readonly kind: "minutes"; readonly minutes: number }
  | { readonly kind: "unlimited" };

/**
 * One named, typed value of an entry or a return.
 * @remarks
 * JSON and boolean values travel as `text`, as the value ports of a plan do.
 */
export interface AgentPlanEntryValue {
  readonly name: string;
  readonly type: AgentParameterType;
}

/** An input an entry accepts from other plans. */
export interface AgentPlanEntryInput extends AgentPlanEntryValue {
  readonly isRequired: boolean;
  readonly defaultValue: AgentParameterValue | null;
}

/** A value an end hands back to the caller of the run. */
export type AgentPlanEntryReturn = AgentPlanEntryValue;

/** The address of an entry: the stable plan and node ids; the names are display only. */
export interface AgentPlanJumpTarget {
  readonly planId: string;
  readonly entryNodeId: string;
  readonly planName: string;
  readonly entryName: string;
}

/** The receiving side: a named entry that starts a new run of its plan. */
export interface AgentPlanJumpIn extends AgentPlanPosition {
  readonly id: string;
  readonly type: "jump";
  readonly direction: "in";
  readonly name: string;
  /** Whether other plans may call this entry; it is on when the entry is created. */
  readonly isEnabled: boolean;
  readonly inputs: readonly AgentPlanEntryInput[];
}

/** The calling side: runs another plan at one entry and waits as configured. */
export interface AgentPlanJumpOut extends AgentPlanPosition {
  readonly id: string;
  readonly type: "jump";
  readonly direction: "out";
  readonly name?: string;
  readonly target: AgentPlanJumpTarget | null;
  readonly wait: AgentPlanJumpWait;
  /** The signal a `signal` wait listens for. */
  readonly signalName?: string;
  readonly timeout: AgentPlanJumpTimeout;
  readonly workspace: AgentPlanJumpWorkspace;
  /** The type of the payload a `signal` wait hands on; absent means text. */
  readonly payloadType?: AgentParameterType;
  /** The inputs of the target as they were when it was chosen; the ports follow this copy. */
  readonly inputs: readonly AgentPlanEntryInput[];
  /** The returns of the target as they were when it was chosen. */
  readonly returns: readonly AgentPlanEntryReturn[];
  /** What fills each input of the call, by the name of the input. */
  readonly bindings: Readonly<Record<string, AgentPlanBinding>>;
}

/** A Jump node of either direction. */
export type AgentPlanJump = AgentPlanJumpIn | AgentPlanJumpOut;

/**
 * Sends an intermediate message to the caller of the run.
 * @remarks
 * The receiver is always the caller of this run; a run without a caller
 * continues without delivery. The payload comes from the binding `payload`.
 */
export interface AgentPlanSignal extends AgentPlanPosition {
  readonly id: string;
  readonly type: "signal";
  readonly name?: string;
  readonly signalName: string;
  /** Absent means no payload. */
  readonly payloadType?: AgentParameterType;
  readonly bindings: Readonly<Record<string, AgentPlanBinding>>;
}

/** The name of the binding that fills the payload of a signal. */
export const PLAN_SIGNAL_PAYLOAD_BINDING = "payload";

/**
 * The handles of the Jump and signal nodes.
 * @remarks
 * `entryOut(name)` is a value output of a receiving entry, `returnOut(name)` a
 * returned value of a calling Jump. An input of a calling Jump uses the name of
 * the input as the binding name.
 */
export const PLAN_JUMP_PORT = {
  errorOut: PLAN_PORT.errorOut,
  timeoutOut: PLAN_PORT.timeoutOut,
  runIdOut: "run-id-out",
  reasonOut: "reason-out",
  payloadOut: "payload-out",
  payloadIn: "payload-in",
} as const;

/** The value output of a receiving entry for one accepted input. */
export function planEntryOutputPort(name: string): string {
  return `entry:${name}`;
}

/** The value output of a calling Jump for one returned value. */
export function planReturnOutputPort(name: string): string {
  return `return:${name}`;
}

/** The name an output port stands for, or `null` for a port of another kind. */
export function planPortName(
  port: string,
  prefix: "entry" | "return",
): string | null {
  return port.startsWith(`${prefix}:`) ? port.slice(prefix.length + 1) : null;
}

/** Whether the node receives calls. */
export function isPlanJumpIn(
  node: AgentPlanNode | undefined,
): node is AgentPlanJumpIn {
  return node?.type === "jump" && node.direction === "in";
}

/** Whether the node calls another plan. */
export function isPlanJumpOut(
  node: AgentPlanNode | undefined,
): node is AgentPlanJumpOut {
  return node?.type === "jump" && node.direction === "out";
}

/** A start or receiving Jump: a node a run can begin at. */
export type AgentPlanEntryNode = AgentPlanStart | AgentPlanJumpIn;

/** Whether a run can begin at the node. */
export function isPlanEntryNode(
  node: AgentPlanNode | undefined,
): node is AgentPlanEntryNode {
  return node?.type === "start" || isPlanJumpIn(node);
}

/** Whether other plans may call the entry. */
export function isPlanEntryCallable(node: AgentPlanEntryNode): boolean {
  return node.type === "start" ? node.callable === true : node.isEnabled;
}

/** The display name of an entry. */
export function planEntryName(node: AgentPlanEntryNode): string {
  if (node.type === "start") return node.name?.trim() || "Start";
  return node.name;
}

/** The accepted inputs of an entry; a start without a declaration accepts none. */
export function planEntryInputs(
  node: AgentPlanEntryNode,
): readonly AgentPlanEntryInput[] {
  return node.inputs ?? [];
}

/** The outer entries of a plan that other plans may call. */
export function planCallableEntries(
  plan: Pick<AgentPlanInput, "nodes">,
): readonly AgentPlanEntryNode[] {
  return plan.nodes.filter(
    (node): node is AgentPlanEntryNode =>
      isPlanEntryNode(node) && isPlanEntryCallable(node),
  );
}

/** What a call of one entry needs and returns. */
export interface AgentPlanEntryContract {
  readonly entryNodeId: string;
  readonly entryName: string;
  readonly direction: "start" | "in";
  readonly inputs: readonly AgentPlanEntryInput[];
  readonly returns: readonly AgentPlanEntryReturn[];
  /** Set when the reachable ends declare returns that contradict each other. */
  readonly hasReturnConflict: boolean;
}

function sortedReturns(
  returns: readonly AgentPlanEntryReturn[],
): readonly AgentPlanEntryReturn[] {
  return [...returns].sort((first, second) =>
    first.name.localeCompare(second.name),
  );
}

function sameReturns(
  first: readonly AgentPlanEntryReturn[],
  second: readonly AgentPlanEntryReturn[],
): boolean {
  const left = sortedReturns(first);
  const right = sortedReturns(second);
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.name === right[index]?.name && entry.type === right[index]?.type,
    )
  );
}

/** The ends a run that begins at the entry can reach along its execution edges. */
export function planReachableEnds(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
  entryNodeId: string,
): readonly AgentPlanEnd[] {
  return plan.nodes.filter(
    (node): node is AgentPlanEnd =>
      node.type === "end" && hasPlanPath(plan.edges, entryNodeId, node.id),
  );
}

/**
 * The call contract of one entry: its inputs and the returns of the ends it reaches.
 * @remarks
 * Only reachable ends return values. Reachable ends must declare the same
 * returns, otherwise the caller could not rely on any of them.
 * @returns `null` for a node that is no entry.
 */
export function planEntryContract(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
  entryNodeId: string,
): AgentPlanEntryContract | null {
  const node = plan.nodes.find((entry) => entry.id === entryNodeId);
  if (!isPlanEntryNode(node)) return null;
  const ends = planReachableEnds(plan, entryNodeId);
  const first = ends[0]?.returns ?? [];
  const hasReturnConflict = ends.some(
    (end) => !sameReturns(first, end.returns ?? []),
  );
  return {
    entryNodeId,
    entryName: planEntryName(node),
    direction: node.type === "start" ? "start" : "in",
    inputs: planEntryInputs(node),
    returns: sortedReturns(first),
    hasReturnConflict,
  };
}

/** The type a port binding delivers, or `null` when the port does not exist. */
export function planPortType(
  plan: Pick<AgentPlanInput, "nodes">,
  nodeId: string,
  port: string,
): AgentParameterType | null {
  const node = plan.nodes.find((entry) => entry.id === nodeId);
  if (isPlanEntryNode(node)) {
    const name = planPortName(port, "entry");
    return (
      planEntryInputs(node).find((input) => input.name === name)?.type ?? null
    );
  }
  if (!isPlanJumpOut(node)) return null;
  if (port === PLAN_JUMP_PORT.runIdOut || port === PLAN_JUMP_PORT.reasonOut)
    return "text";
  if (port === PLAN_JUMP_PORT.payloadOut)
    return node.wait === "signal" ? (node.payloadType ?? "text") : null;
  const name = planPortName(port, "return");
  if (name === null || node.wait !== "completion") return null;
  return node.returns.find((entry) => entry.name === name)?.type ?? null;
}

/** Whether a value of one type feeds an input of another. */
export function fitsPlanPortType(
  delivered: AgentParameterType,
  expected: AgentParameterType,
): boolean {
  return delivered === expected;
}

/** The finite wait of an outgoing Jump in minutes, or `null` while it waits without limit or does not wait. */
export function planJumpMinutes(node: AgentPlanJumpOut): number | null {
  if (node.wait === "continue") return null;
  return node.timeout.kind === "minutes" ? node.timeout.minutes : null;
}

/** Whether the outgoing Jump has a timeout output: it waits for a finite time. */
export function hasPlanJumpTimeout(node: AgentPlanJumpOut): boolean {
  return planJumpMinutes(node) !== null;
}

/** The flow outputs of a calling Jump that lead somewhere else than the normal exit. */
export function planJumpFailurePorts(node: AgentPlanJumpOut): readonly string[] {
  return hasPlanJumpTimeout(node)
    ? [PLAN_JUMP_PORT.errorOut, PLAN_JUMP_PORT.timeoutOut]
    : [PLAN_JUMP_PORT.errorOut];
}

function isEntryValueValid(entry: AgentPlanEntryValue): boolean {
  return (
    isAgentParameterName(entry.name) &&
    ["text", "number", "ticket", "workspace", "wiki", "asset"].includes(
      entry.type,
    )
  );
}

function areNamesUnique(entries: readonly AgentPlanEntryValue[]): boolean {
  return new Set(entries.map((entry) => entry.name)).size === entries.length;
}

function isDefaultValid(input: AgentPlanEntryInput): boolean {
  return input.defaultValue === null || input.defaultValue.type === input.type;
}

/** Whether a list of declared inputs is complete, bounded and free of contradictions. */
export function arePlanEntryInputsValid(
  inputs: readonly AgentPlanEntryInput[],
): boolean {
  return (
    inputs.length <= PLAN_JUMP_VALUE_COUNT &&
    areNamesUnique(inputs) &&
    inputs.every((input) => isEntryValueValid(input) && isDefaultValid(input))
  );
}

/** Whether a list of declared returns is complete, bounded and free of contradictions. */
export function arePlanEntryReturnsValid(
  returns: readonly AgentPlanEntryReturn[],
): boolean {
  return (
    returns.length <= PLAN_JUMP_VALUE_COUNT &&
    areNamesUnique(returns) &&
    returns.every(isEntryValueValid)
  );
}

/** Whether a signal name is a bounded identifier. */
export function isPlanSignalName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= PLAN_JUMP_SIGNAL_LENGTH &&
    /^[a-zA-Z][a-zA-Z0-9_.-]*$/u.test(name)
  );
}

function isTimeoutValid(timeout: AgentPlanJumpTimeout): boolean {
  return (
    timeout.kind === "unlimited" ||
    (Number.isInteger(timeout.minutes) &&
      timeout.minutes >= 1 &&
      timeout.minutes <= PLAN_JUMP_MAX_MINUTES)
  );
}

/** The start of a plan as a callable entry; the switch is off by default. */
export function planStartCallable(start: AgentPlanStart): boolean {
  return start.callable === true;
}

function outIssues(node: AgentPlanJumpOut): AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [];
  if (node.target === null)
    issues.push({ nodeId: node.id, port: null, reason: "jumpTarget" });
  if (
    !["continue", "completion", "signal"].includes(node.wait) ||
    (node.wait === "signal" && !isPlanSignalName(node.signalName ?? ""))
  )
    issues.push({ nodeId: node.id, port: null, reason: "jumpWait" });
  if (!isTimeoutValid(node.timeout))
    issues.push({ nodeId: node.id, port: null, reason: "jumpTimeout" });
  if (node.workspace === "shared" && node.wait === "continue")
    issues.push({ nodeId: node.id, port: null, reason: "jumpWorkspace" });
  if (
    !arePlanEntryInputsValid(node.inputs) ||
    !arePlanEntryReturnsValid(node.returns)
  )
    issues.push({ nodeId: node.id, port: null, reason: "jumpInput" });
  return issues;
}

function inIssues(node: AgentPlanJumpIn): AgentPlanIssue[] {
  const name = node.name.trim();
  const issues: AgentPlanIssue[] = [];
  if (
    name.length === 0 ||
    name.length > PLAN_JUMP_NAME_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(name)
  )
    issues.push({ nodeId: node.id, port: null, reason: "name" });
  if (!arePlanEntryInputsValid(node.inputs))
    issues.push({ nodeId: node.id, port: null, reason: "jumpInput" });
  return issues;
}

/** The ports an edge may use at a node of the plan, by direction of the edge. */
function jumpPorts(node: AgentPlanNode): {
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
} | null {
  if (node.type === "signal")
    return { inputs: ["flow-in"], outputs: ["flow-out"] };
  if (isPlanJumpIn(node)) return { inputs: [], outputs: ["flow-out"] };
  if (!isPlanJumpOut(node)) return null;
  return {
    inputs: ["flow-in"],
    outputs: ["flow-out", ...planJumpFailurePorts(node)],
  };
}

/** Edges that use a port the stored configuration of a Jump or signal does not have. */
function portIssues(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
): AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [];
  for (const edge of plan.edges) {
    const source = plan.nodes.find((node) => node.id === edge.from);
    const target = plan.nodes.find((node) => node.id === edge.to);
    const sourcePorts = source ? jumpPorts(source) : null;
    const targetPorts = target ? jumpPorts(target) : null;
    if (sourcePorts && !sourcePorts.outputs.includes(edge.fromPort))
      issues.push({ nodeId: edge.from, port: edge.fromPort, reason: "port" });
    if (targetPorts && !targetPorts.inputs.includes(edge.toPort))
      issues.push({ nodeId: edge.to, port: edge.toPort, reason: "port" });
  }
  return issues;
}

function isBindingKindAllowed(binding: AgentPlanBinding): boolean {
  return (
    binding.kind === "literal" ||
    binding.kind === "source" ||
    binding.kind === "result" ||
    binding.kind === "port"
  );
}

function bindingTypeOf(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
  binding: AgentPlanBinding,
): AgentParameterType | "any" | null {
  if (binding.kind === "literal")
    return binding.value === null ? "any" : binding.value.type;
  if (binding.kind === "result") return "text";
  if (binding.kind === "port")
    return planPortType(plan, binding.nodeId, binding.port);
  if (binding.kind !== "source") return null;
  const source = plan.nodes.find((node) => node.id === binding.nodeId);
  if (source?.type === "parameter") return source.value.type;
  if (source?.type === "variable") return "text";
  if (source?.type === "task") return "ticket";
  if (source?.type === "asset") return "asset";
  return null;
}

/** The binding problems of the values a node hands over: an input, a return or a payload. */
function valueBindingIssues(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
  nodeId: string,
  declared: readonly AgentPlanEntryValue[],
  bindings: Readonly<Record<string, AgentPlanBinding>>,
): AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [];
  for (const [name, binding] of Object.entries(bindings)) {
    const entry = declared.find((value) => value.name === name);
    if (!entry) {
      issues.push({ nodeId, port: name, reason: "port" });
      continue;
    }
    const delivered = isBindingKindAllowed(binding)
      ? bindingTypeOf(plan, binding)
      : null;
    if (
      delivered === null ||
      (delivered !== "any" && !fitsPlanPortType(delivered, entry.type)) ||
      (binding.kind === "result" && entry.type !== "text")
    )
      issues.push({ nodeId, port: name, reason: "type" });
  }
  return issues;
}

/**
 * The bindings of a node whose declared values must be filled: an unfilled required input is an issue.
 * @remarks
 * A required input with a default value is satisfied by the default.
 */
function requiredInputIssues(
  nodeId: string,
  inputs: readonly AgentPlanEntryInput[],
  bindings: Readonly<Record<string, AgentPlanBinding>>,
): AgentPlanIssue[] {
  return inputs.flatMap((input): AgentPlanIssue[] =>
    input.isRequired && input.defaultValue === null && !bindings[input.name]
      ? [{ nodeId, port: input.name, reason: "required" }]
      : [],
  );
}

function signalIssues(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
  node: AgentPlanSignal,
): AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [];
  if (!isPlanSignalName(node.signalName))
    issues.push({ nodeId: node.id, port: null, reason: "signalName" });
  const declared: readonly AgentPlanEntryValue[] = node.payloadType
    ? [{ name: PLAN_SIGNAL_PAYLOAD_BINDING, type: node.payloadType }]
    : [];
  issues.push(
    ...valueBindingIssues(plan, node.id, declared, node.bindings),
  );
  return issues;
}

function endIssues(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
  node: AgentPlanEnd,
): AgentPlanIssue[] {
  const returns = node.returns ?? [];
  const issues: AgentPlanIssue[] = [];
  if (!arePlanEntryReturnsValid(returns))
    issues.push({ nodeId: node.id, port: null, reason: "jumpInput" });
  issues.push(
    ...valueBindingIssues(plan, node.id, returns, node.bindings ?? {}),
  );
  for (const entry of returns)
    if (!node.bindings?.[entry.name])
      issues.push({ nodeId: node.id, port: entry.name, reason: "required" });
  return issues;
}

function startIssues(node: AgentPlanStart): AgentPlanIssue[] {
  return arePlanEntryInputsValid(node.inputs ?? [])
    ? []
    : [{ nodeId: node.id, port: null, reason: "jumpInput" }];
}

/** A receiving entry exists on the outer plane only; one inside a group or loop is refused. */
function boundaryIssues(
  plan: Pick<AgentPlanInput, "nodes">,
): AgentPlanIssue[] {
  const outer = new Set(plan.nodes.map((node) => node.id));
  return planContainedNodes(plan)
    .filter((node) => isPlanJumpIn(node) && !outer.has(node.id))
    .map((node) => ({
      nodeId: node.id,
      port: null,
      reason: "jumpBoundary",
    }));
}

/** Whether two entries of one plan contradict each other: the reachable ends of one entry. */
function contractIssues(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
): AgentPlanIssue[] {
  return plan.nodes.flatMap((node): AgentPlanIssue[] => {
    if (!isPlanEntryNode(node)) return [];
    return planEntryContract(plan, node.id)?.hasReturnConflict
      ? [{ nodeId: node.id, port: null, reason: "returnContract" }]
      : [];
  });
}

/**
 * The structural findings of the Jump, signal, start and end nodes of a plan.
 * @param plan - The plan with its groups and loops still in place.
 * @remarks
 * These checks need no other plan and are valid for drafts too. Whether a
 * target still exists and has the interface the node stored is checked where
 * the other plans are known.
 */
export function planJumpIssues(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
): readonly AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [
    ...portIssues(plan),
    ...boundaryIssues(plan),
    ...contractIssues(plan),
  ];
  for (const node of plan.nodes) {
    if (node.type === "start") issues.push(...startIssues(node));
    if (node.type === "end") issues.push(...endIssues(plan, node));
    if (node.type === "signal") issues.push(...signalIssues(plan, node));
    if (isPlanJumpIn(node)) issues.push(...inIssues(node));
    if (!isPlanJumpOut(node)) continue;
    issues.push(
      ...outIssues(node),
      ...valueBindingIssues(plan, node.id, node.inputs, node.bindings),
      ...requiredInputIssues(node.id, node.inputs, node.bindings),
    );
  }
  return issues;
}

/** Edges that leave a Jump through a failure output, for the editor's "unconnected: plan fails" notice. */
export function planJumpFailureEdges(
  plan: Pick<AgentPlanInput, "edges">,
  node: AgentPlanJumpOut,
  port: string,
): readonly AgentPlanEdge[] {
  return plan.edges.filter(
    (edge) => edge.from === node.id && edge.fromPort === port,
  );
}

/**
 * Whether a node of the plan is hit by the chain of calls: the entry a call names, in a plan that calls on.
 * @param calls - The edges of the call graph: `from` plan calls `to` plan.
 * @param from - The calling plan.
 * @param to - The called plan.
 * @returns Whether calling `to` from `from` would close a cycle of calls.
 */
export function wouldCloseCallCycle(
  calls: readonly { readonly from: string; readonly to: string }[],
  from: string,
  to: string,
): boolean {
  if (from === to) return true;
  const visited = new Set<string>();
  const pending = [to];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (id === from) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const call of calls) if (call.from === id) pending.push(call.to);
  }
  return false;
}

/** The plans one plan calls, read from its outgoing Jumps. */
export function planCalledPlanIds(
  plan: Pick<AgentPlanInput, "nodes">,
): readonly string[] {
  return [
    ...new Set(
      plan.nodes.flatMap((node) =>
        isPlanJumpOut(node) && node.target ? [node.target.planId] : [],
      ),
    ),
  ];
}

/** The states a call goes through; the first three end nothing, the others are final. */
export const PLAN_INVOCATION_STATES = [
  "queued",
  "starting",
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
  "accepted",
  "signalled",
] as const;

/** One of {@link PLAN_INVOCATION_STATES}. */
export type AgentPlanInvocationState = (typeof PLAN_INVOCATION_STATES)[number];

/** Whether a call reached its final state. */
export function isPlanInvocationFinal(state: AgentPlanInvocationState): boolean {
  return (
    state === "succeeded" ||
    state === "failed" ||
    state === "timed_out" ||
    state === "cancelled" ||
    state === "accepted" ||
    state === "signalled"
  );
}

/** What happened to the Workspace of a calling plan during a shared call. */
export const PLAN_HANDOVER_STATES = [
  "none",
  "handed_over",
  "returned",
] as const;

/** One of {@link PLAN_HANDOVER_STATES}. */
export type AgentPlanHandoverState = (typeof PLAN_HANDOVER_STATES)[number];

/**
 * The outgoing Jump as the run of the calling plan shows it.
 * @remarks
 * The values of the call stay with the call. This view carries only what the
 * run card and the links need.
 */
export const planJumpRunSchema = z.object({
  invocationId: z.string().min(1).max(200),
  targetPlanId: z.string().min(1).max(200),
  targetPlanName: z.string().max(200),
  entryNodeId: z.string().min(1).max(200),
  wait: z.enum(["continue", "completion", "signal"]),
  state: z.enum(PLAN_INVOCATION_STATES),
  targetRunId: z.string().min(1).max(200).nullable(),
  /** `queued`, a run status, or `none` before the target has a run. */
  targetStatus: z.string().max(40),
  deadlineAt: z.string().max(40).nullable(),
  handover: z.enum(PLAN_HANDOVER_STATES),
  /** A signal was accepted for this call. */
  hasSignal: z.boolean(),
  /** A safe failure code when the call ended without success. */
  reason: z.string().max(120).nullable(),
});

/** The view of one outgoing Jump in a run. */
export type AgentPlanJumpRun = z.infer<typeof planJumpRunSchema>;

/**
 * The call a run was started by, shown on the run of the target.
 * @remarks
 * The link back to the calling run only appears for people who may read it.
 */
export const planRunInvocationSchema = z.object({
  invocationId: z.string().min(1).max(200),
  entryNodeId: z.string().min(1).max(200),
  sourcePlanId: z.string().min(1).max(200),
  sourceRunId: z.string().min(1).max(200),
  sourceNodeId: z.string().min(1).max(200),
  wait: z.enum(["continue", "completion", "signal"]),
});

/** The call a run was started by. */
export type AgentPlanRunInvocation = z.infer<typeof planRunInvocationSchema>;

/** One entry of another plan that a calling Jump may choose. */
export interface AgentPlanCallEntry {
  readonly entryNodeId: string;
  readonly entryName: string;
  /** `start` is the released start of the plan, `in` a receiving Jump. */
  readonly kind: "start" | "in";
  readonly inputs: readonly AgentPlanEntryInput[];
  readonly returns: readonly AgentPlanEntryReturn[];
  /** The ends this entry reaches declare contradicting returns; the entry cannot be called. */
  readonly hasReturnConflict: boolean;
}

/**
 * A plan the person may call, with the entries that are released for calls.
 * @remarks
 * Only plans the person may read and run, with entries that are released,
 * appear here. The server checks every call again when it is made.
 */
export interface AgentPlanCallTarget {
  readonly planId: string;
  readonly planName: string;
  readonly revision: number;
  readonly entries: readonly AgentPlanCallEntry[];
}

/**
 * What a signal node did with its message.
 * @remarks
 * `no_caller` is the run that nobody called: the node goes on without
 * delivery, and that is no successful sending. `duplicate` is a repeated
 * signal of a name already sent; `closed` is a call that was decided,
 * cancelled or timed out before the message arrived.
 */
export const planSignalRunSchema = z.object({
  delivered: z.boolean(),
  reason: z.enum(["delivered", "no_caller", "duplicate", "closed"]),
  name: z.string().max(PLAN_JUMP_SIGNAL_LENGTH),
});

/** The result of a signal node. */
export type AgentPlanSignalRun = z.infer<typeof planSignalRunSchema>;
