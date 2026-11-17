import type {
  AgentParameterType,
  AgentParameterValue,
} from "./AgentParameters.js";
import type { AgentPlanBindingEntry } from "./AgentPlanBindingEntry.js";

/** One named, typed value an entry accepts or an end returns. */
export interface AgentPlanEntryValueEntry {
  readonly name: string;
  readonly type: AgentParameterType;
}

/** An input an entry accepts from other plans; a required input with a default is satisfied by it. */
export interface AgentPlanEntryInputEntry extends AgentPlanEntryValueEntry {
  readonly isRequired: boolean;
  readonly defaultValue: AgentParameterValue | null;
}

/** The address of the entry a calling Jump runs: the stable ids, and the names as they were when it was chosen. */
export interface AgentPlanJumpTargetEntry {
  readonly planId: string;
  readonly entryNodeId: string;
  readonly planName: string;
  readonly entryName: string;
}

/** How long a waiting call waits, counted from the durable acceptance of the call. */
export type AgentPlanJumpTimeoutEntry =
  | { readonly kind: "minutes"; readonly minutes: number }
  | { readonly kind: "unlimited" };

interface AgentPlanCallNodeBase {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** What the plan page shows for the node: its name, or what it points at. */
  readonly label: string;
}

/** A receiving entry: starts a new run of its plan when another plan calls it. */
export interface AgentPlanJumpInNodeEntry extends AgentPlanCallNodeBase {
  readonly type: "jump";
  readonly direction: "in";
  readonly name: string;
  /** Whether other plans may call the entry. */
  readonly isEnabled: boolean;
  readonly inputs: readonly AgentPlanEntryInputEntry[];
}

/**
 * A call: runs another plan at one entry and waits as configured.
 * @remarks
 * `wait` is `continue` (goes on once the call is accepted), `completion`
 * (waits for the target run to end successfully) or `signal` (waits for the
 * named signal of this call). `inputs` and `returns` mirror the target as it
 * was when it was chosen; `bindings` fills each input by its name. The
 * outputs `error-out` and, with a finite wait, `timeout-out` lead on when the
 * call failed or the wait ran out.
 */
export interface AgentPlanJumpOutNodeEntry extends AgentPlanCallNodeBase {
  readonly type: "jump";
  readonly direction: "out";
  readonly name?: string;
  readonly target: AgentPlanJumpTargetEntry | null;
  readonly wait: "continue" | "completion" | "signal";
  readonly signalName?: string;
  readonly timeout: AgentPlanJumpTimeoutEntry;
  /** `shared` hands the workspace of the calling plan over, and only while the call waits. */
  readonly workspace: "own" | "shared";
  readonly payloadType?: AgentParameterType;
  readonly inputs: readonly AgentPlanEntryInputEntry[];
  readonly returns: readonly AgentPlanEntryValueEntry[];
  readonly bindings: Readonly<Record<string, AgentPlanBindingEntry>>;
}

/** Sends a message to the caller of the run; a run without a caller goes on without delivery. */
export interface AgentPlanSignalNodeEntry extends AgentPlanCallNodeBase {
  readonly type: "signal";
  readonly name?: string;
  readonly signalName: string;
  /** Absent means no payload; the payload is the binding `payload`. */
  readonly payloadType?: AgentParameterType;
  readonly bindings: Readonly<Record<string, AgentPlanBindingEntry>>;
}

/** The start of a plan, optionally an entry other plans may call. */
export interface AgentPlanStartNodeEntry extends AgentPlanCallNodeBase {
  readonly type: "start";
  readonly name?: string;
  readonly callable?: boolean;
  readonly inputs?: readonly AgentPlanEntryInputEntry[];
}

/** The end of a plan; the declared returns are handed to a caller that ended successfully. */
export interface AgentPlanEndNodeEntry extends AgentPlanCallNodeBase {
  readonly type: "end";
  readonly returns?: readonly AgentPlanEntryValueEntry[];
  readonly bindings?: Readonly<Record<string, AgentPlanBindingEntry>>;
}

/** The nodes through which plans call each other, and the start and end that carry their contract. */
export type AgentPlanCallNodeEntry =
  | AgentPlanJumpInNodeEntry
  | AgentPlanJumpOutNodeEntry
  | AgentPlanSignalNodeEntry
  | AgentPlanStartNodeEntry
  | AgentPlanEndNodeEntry;

/** One entry of another plan that a calling Jump may choose. */
export interface AgentPlanCallEntryEntry {
  readonly entryNodeId: string;
  readonly entryName: string;
  /** `start` is the callable start of the plan, `in` a receiving Jump. */
  readonly kind: "start" | "in";
  readonly inputs: readonly AgentPlanEntryInputEntry[];
  readonly returns: readonly AgentPlanEntryValueEntry[];
  /** The ends this entry reaches declare contradicting returns; the entry cannot be called. */
  readonly hasReturnConflict: boolean;
}

/** A plan the account may call, with the entries that are released for calls. */
export interface AgentPlanCallTargetEntry {
  readonly planId: string;
  readonly planName: string;
  readonly revision: number;
  readonly entries: readonly AgentPlanCallEntryEntry[];
}
