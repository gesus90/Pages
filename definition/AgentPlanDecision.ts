import { planContainedNodes } from "./AgentPlanGroupLoop";

import type {
  AgentPlanBinding,
  AgentPlanDecision,
  AgentPlanInput,
  AgentPlanNode,
} from "./AgentPlan";

/**
 * How a decision decides.
 * @remarks
 * `boolean` reads a boolean parameter or the boolean result of an agent and
 * calls no model. `model` asks an OpenRouter decision model one typed
 * question about one source through the decisions interface, without a
 * session. Absent means `boolean`, the only kind of decision before this
 * field existed.
 */
export type AgentPlanDecisionMode = "boolean" | "model";

/** What a model decision answers: yes or no, or one of the values of its list. */
export type AgentPlanDecisionOutput = "boolean" | "classification";

/** One value a classifying decision can answer, with an output of its own. */
export interface AgentPlanDecisionCase {
  /** Stable: the output port `case:<id>` keeps its connection when the value is renamed. */
  readonly id: string;
  readonly name: string;
}

/**
 * The decision model a decision asks: a model of an OpenRouter connection
 * whose catalog states `decisions` among its outputs.
 * @remarks
 * Decision models have no reasoning level. A decision without a model of its
 * own asks the decision model of the instance.
 */
export interface AgentPlanDecisionModel {
  readonly connectionId: string;
  readonly model: string;
}

/** The answer of a model decision, as the run shows it. */
export interface AgentPlanDecisionVerdict {
  /** `true`/`false` for yes or no, the name of the value for a classification. */
  readonly decision: boolean | string;
  /** The value of a classification; absent for yes or no. */
  readonly caseId?: string;
  /** Why the model answered so; empty for a decision model, which gives no reason. */
  readonly reason: string;
  /**
   * The probability the decision model gave the answer, 0 to 1: of yes for
   * yes or no, of the chosen value for a classification; absent when it gave none.
   */
  readonly probability?: number;
  /** How sure the decision model was, 0 to 1; absent when it stated nothing. */
  readonly confidence?: number;
  /** What the call cost in US dollars; absent when the provider stated no cost. */
  readonly costUsd?: number;
  /** The model that answered, as the decision named it. */
  readonly model: string;
  /** The node the decision read: a ticket node, an agent or a script. */
  readonly sourceStepId: string;
  /** Which start of the agent or script delivered the text; absent for a ticket. */
  readonly sourceActivation?: number;
  /** Whether the model had to correct its first answer; never for a decision model, which is asked once. */
  readonly isCorrected: boolean;
}

/** The prefix of the output port of one value of a classification. */
export const PLAN_DECISION_CASE_PREFIX = "case:";

/** The bounds of the value list of a classification. */
export const PLAN_DECISION_CASES = { minimum: 2, maximum: 20 } as const;

/** The longest name of one value. */
export const PLAN_DECISION_CASE_NAME_LENGTH = 60;

/** The longest question a decision asks. */
export const PLAN_DECISION_QUESTION_LENGTH = 4_000;

/** The longest reason a run keeps of an answer. */
export const PLAN_DECISION_REASON_LENGTH = 2_000;

/** From this probability of yes on, a yes/no decision answers yes; fixed, not configurable. */
export const PLAN_DECISION_YES_THRESHOLD = 0.5;

/** The longest wait for the decisions interface in a plan, in milliseconds. */
export const PLAN_DECISION_TIMEOUT_MS = 120_000;

/** The longest source text a model decision hands over; Pages never shortens it. */
export const PLAN_DECISION_SOURCE_LIMIT = 100_000;

/** The mode of a decision; a decision saved before modes existed reads booleans. */
export function planDecisionMode(
  decision: Pick<AgentPlanDecision, "mode">,
): AgentPlanDecisionMode {
  return decision.mode ?? "boolean";
}

/** Whether the decision answers yes or no or classifies; only a model decision classifies. */
export function planDecisionOutput(
  decision: Pick<AgentPlanDecision, "mode" | "output">,
): AgentPlanDecisionOutput {
  return planDecisionMode(decision) === "model" &&
    decision.output === "classification"
    ? "classification"
    : "boolean";
}

/** The output port of one value of a classification. */
export function planDecisionCasePort(caseId: string): string {
  return `${PLAN_DECISION_CASE_PREFIX}${caseId}`;
}

/** The value id an output port names, or `null` for any other port. */
export function planDecisionCaseId(port: string): string | null {
  return port.startsWith(PLAN_DECISION_CASE_PREFIX) &&
    port.length > PLAN_DECISION_CASE_PREFIX.length
    ? port.slice(PLAN_DECISION_CASE_PREFIX.length)
    : null;
}

/**
 * The outputs a decision offers now, in the order the card shows them.
 *
 * @remarks
 * Yes or no and booleans have `true-out` and `false-out`; a classification has
 * one `case:<id>` per value of its list and no automatic "else".
 */
export function planDecisionOutputPorts(
  decision: Pick<AgentPlanDecision, "mode" | "output" | "cases">,
): readonly string[] {
  if (planDecisionOutput(decision) === "boolean")
    return ["true-out", "false-out"];
  return (decision.cases ?? []).map((entry) => planDecisionCasePort(entry.id));
}

/** The data input bound to a decision, or `undefined` when it reads an agent's boolean edge or nothing. */
export function planDecisionBinding(
  decision: Pick<AgentPlanDecision, "input">,
): AgentPlanBinding | undefined {
  return decision.input;
}

/** Why the value list of a classification is invalid, or `null` when it is valid. */
export function planDecisionCasesProblem(
  cases: readonly AgentPlanDecisionCase[] | undefined,
): "count" | "name" | "duplicate" | null {
  const list = cases ?? [];
  if (
    list.length < PLAN_DECISION_CASES.minimum ||
    list.length > PLAN_DECISION_CASES.maximum
  )
    return "count";
  if (
    list.some(
      (entry) =>
        entry.name.trim().length === 0 ||
        entry.name.length > PLAN_DECISION_CASE_NAME_LENGTH ||
        entry.name !== entry.name.trim(),
    )
  )
    return "name";
  const names = new Set(list.map((entry) => entry.name.toLowerCase()));
  const ids = new Set(list.map((entry) => entry.id));
  return names.size === list.length && ids.size === list.length
    ? null
    : "duplicate";
}

/** Whether a parameter node holds a boolean: the format `boolean` with exactly `true` or `false`. */
export function planBooleanParameterValue(
  node: AgentPlanNode | undefined,
): boolean | null {
  if (node?.type !== "parameter" || node.format !== "boolean") return null;
  if (node.value.type !== "text") return null;
  if (node.value.text === "true") return true;
  return node.value.text === "false" ? false : null;
}

/**
 * Every decision of a plan, those inside groups and loops included.
 *
 * @param plan - The saved plan with its groups and loops.
 */
export function allPlanDecisions(
  plan: Pick<AgentPlanInput, "nodes">,
): readonly AgentPlanDecision[] {
  return planContainedNodes(plan).filter((node) => node.type === "decision");
}
