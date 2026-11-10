import type { AcpProviderId } from "./AgentConfiguration";
import type {
  AgentPlanBinding,
  AgentPlanDecision,
  AgentPlanInput,
  AgentPlanNode,
} from "./AgentPlan";

/**
 * How a decision decides (PAGE-286).
 *
 * @remarks
 * `boolean` reads a boolean parameter or the boolean result of an agent and
 * calls no model. `model` asks a model of an ACP connection one question about
 * one source in a short session of its own. Absent means `boolean`, the only
 * kind of decision before this field existed.
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

/** The model a decision asks, as the model choice of an agent node names it. */
export interface AgentPlanDecisionModel {
  readonly connectionId: string;
  readonly provider: AcpProviderId;
  readonly model: string;
  readonly reasoningEffort: string | null;
}

/** The answer of a model decision and why, as the run shows it. */
export interface AgentPlanDecisionVerdict {
  /** `true`/`false` for yes or no, the name of the value for a classification. */
  readonly decision: boolean | string;
  /** The value of a classification; absent for yes or no. */
  readonly caseId?: string;
  readonly reason: string;
  /** The model that answered, as the decision named it. */
  readonly model: string;
  /** The node the decision read: a ticket node, an agent or a script. */
  readonly sourceStepId: string;
  /** Which start of the agent or script delivered the text; absent for a ticket. */
  readonly sourceActivation?: number;
  /** Whether the model had to correct its first answer. */
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
  return plan.nodes.flatMap((node): readonly AgentPlanDecision[] => {
    if (node.type === "decision") return [node];
    if (node.type === "group") return node.decisions ?? [];
    if (node.type !== "loop") return [];
    return [
      ...(node.decisions ?? []),
      ...node.steps.flatMap((member) =>
        member.type === "group" ? (member.decisions ?? []) : [],
      ),
    ];
  });
}

/** What one answer of a model says, or why it is no valid answer. */
export type PlanDecisionAnswer =
  | {
      readonly isValid: true;
      readonly decision: boolean | string;
      readonly caseId?: string;
      readonly reason: string;
    }
  | { readonly isValid: false; readonly problem: string };

function invalid(problem: string): PlanDecisionAnswer {
  return { isValid: false, problem };
}

function parsedObject(text: string): Record<string, unknown> | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return "The answer is not exactly one JSON object; text or code fences around it are not allowed.";
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    return "The answer is JSON but not an object.";
  return Object.fromEntries(Object.entries(parsed));
}

/**
 * Checks the answer of a model decision against its contract.
 *
 * @param text - The whole final answer of the session.
 * @param decision - The decision with its output kind and values.
 * @returns The decision and reason, or the concrete problem the model is told once.
 *
 * @remarks
 * The answer is exactly one JSON object with `decision` and `reason` and
 * nothing else. Yes or no takes a JSON boolean, a classification exactly
 * one of the names of its values. A problem is never read as `false` or as
 * one of the values.
 */
export function readPlanDecisionAnswer(
  text: string,
  decision: Pick<AgentPlanDecision, "mode" | "output" | "cases">,
): PlanDecisionAnswer {
  const answer = parsedObject(text);
  if (typeof answer === "string") return invalid(answer);
  const keys = Object.keys(answer).sort();
  if (keys.length !== 2 || keys[0] !== "decision" || keys[1] !== "reason")
    return invalid(
      'The object must have exactly the two fields "decision" and "reason".',
    );
  const reason = answer.reason;
  if (typeof reason !== "string" || reason.trim().length === 0)
    return invalid('"reason" must be a non-empty string.');
  if (reason.length > PLAN_DECISION_REASON_LENGTH)
    return invalid(
      `"reason" must be at most ${PLAN_DECISION_REASON_LENGTH} characters.`,
    );
  const value = answer.decision;
  if (planDecisionOutput(decision) === "boolean")
    return typeof value === "boolean"
      ? { isValid: true, decision: value, reason: reason.trim() }
      : invalid('"decision" must be the JSON boolean true or false.');
  const match = (decision.cases ?? []).find((entry) => entry.name === value);
  if (typeof value !== "string" || !match)
    return invalid(
      `"decision" must be exactly one of the allowed values: ${JSON.stringify((decision.cases ?? []).map((entry) => entry.name))}.`,
    );
  return {
    isValid: true,
    decision: match.name,
    caseId: match.id,
    reason: reason.trim(),
  };
}
