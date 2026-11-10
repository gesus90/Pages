import type {
  AgentPlanDecisionCase,
  AgentPlanDecisionModel,
} from "./AgentPlanDecision.js";
import type { AgentParameterValue } from "./AgentParameters.js";

/**
 * A decision as a client reads it: a boolean (default) or a model that answers yes or no or classifies (PAGE-286).
 *
 * @remarks
 * `input` is the data input of a boolean parameter, a ticket or a text
 * result; the boolean result of an agent arrives as an edge
 * `passed-out` → `condition-in` instead. A classification has one output
 * port `case:<id>` per value. Declared apart from the other node entries so
 * the operation contract stays within its size.
 */
export interface AgentPlanDecisionNodeEntry {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** What the plan page shows for the node: its name, or the type name. */
  readonly label: string;
  readonly type: "decision";
  readonly name?: string;
  readonly mode?: "boolean" | "model";
  readonly question?: string;
  readonly model?: AgentPlanDecisionModel;
  readonly output?: "boolean" | "classification";
  readonly cases?: readonly AgentPlanDecisionCase[];
  readonly input?:
    | { readonly kind: "literal"; readonly value: AgentParameterValue | null }
    | { readonly kind: "source"; readonly nodeId: string }
    | { readonly kind: "result"; readonly stepId: string }
    | { readonly kind: "previous"; readonly stepId: string }
    | {
        readonly kind: "stack";
        readonly stackId: string;
        readonly output: "content" | "count";
      };
}

/** The decisions a group or loop holds; absent without one. */
export interface AgentPlanFrameDecisions {
  readonly decisions?: readonly Omit<AgentPlanDecisionNodeEntry, "label">[];
}

/** A start, an end or a decision: the control nodes of a plan. */
export type AgentPlanControlNodeEntry =
  | AgentPlanDecisionNodeEntry
  | {
      readonly id: string;
      readonly x: number;
      readonly y: number;
      readonly label: string;
      readonly type: "start" | "end";
    };
