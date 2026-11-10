import { AgentError } from "@/backend/error/AgentErrors";
import { isAcpProvider } from "@/definition/AgentConfiguration";
import { isAgentProvider } from "@/definition/AgentConnection";
import {
  PLAN_DECISION_CASES,
  PLAN_DECISION_CASE_NAME_LENGTH,
  PLAN_DECISION_QUESTION_LENGTH,
} from "@/definition/AgentPlanDecision";

import { readAgentObject } from "./AgentPayload";

import type {
  AgentPlanBinding,
  AgentPlanDecision,
  AgentPlanNode,
  AgentPlanPosition,
} from "@/definition/AgentPlan";
import type {
  AgentPlanDecisionCase,
  AgentPlanDecisionModel,
} from "@/definition/AgentPlanDecision";

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/u;

function readText(input: unknown, maximum: number): string {
  if (
    typeof input !== "string" ||
    input.length > maximum ||
    CONTROL.test(input)
  )
    throw new AgentError("plan_invalid");
  return input;
}

function readIdentifier(input: unknown): string {
  const text = readText(input, 100).trim();
  if (text.length === 0 || /\s/u.test(text))
    throw new AgentError("plan_invalid");
  return text;
}

function readModel(input: unknown): AgentPlanDecisionModel {
  const model = readAgentObject(input);
  const provider = model.provider;
  const effort = model.reasoningEffort;
  if (
    typeof provider !== "string" ||
    !isAgentProvider(provider) ||
    !isAcpProvider(provider) ||
    (effort !== null && typeof effort !== "string")
  )
    throw new AgentError("plan_invalid");
  return {
    connectionId: readIdentifier(model.connectionId),
    provider,
    model: readText(model.model, 300).trim(),
    reasoningEffort: effort === null ? null : readText(effort, 40),
  };
}

function readCases(input: unknown): readonly AgentPlanDecisionCase[] {
  if (!Array.isArray(input) || input.length > PLAN_DECISION_CASES.maximum)
    throw new AgentError("plan_invalid");
  return input.map((entry: unknown) => {
    const value = readAgentObject(entry);
    return {
      id: readIdentifier(value.id),
      name: readText(value.name, PLAN_DECISION_CASE_NAME_LENGTH),
    };
  });
}

function readInput(
  input: unknown,
  readBinding: (input: unknown) => AgentPlanBinding,
): AgentPlanBinding {
  const binding = readBinding(input);
  if (binding.kind !== "source" && binding.kind !== "result")
    throw new AgentError("plan_binding_invalid");
  return binding;
}

/**
 * Parses a decision node; what its settings mean for the run is the graph check's.
 *
 * @param node - The untrusted node.
 * @param base - Its id and position, already read.
 * @param readBinding - The binding reader of the plan, which bounds every reference.
 * @returns The decision, with only the fields it was saved with: a decision of a
 * plan before PAGE-286 stays exactly as it was.
 *
 * @remarks
 * A draft may hold an empty question or an empty value name; the plan check
 * names them before a run may start, so a person can save half-done work.
 */
export function readPlanDecisionNode(
  node: Record<string, unknown>,
  base: AgentPlanPosition & { readonly id: string },
  readBinding: (input: unknown) => AgentPlanBinding,
): AgentPlanDecision {
  const { mode } = node;
  if (mode !== undefined && mode !== "boolean" && mode !== "model")
    throw new AgentError("plan_invalid");
  return {
    ...base,
    type: "decision",
    ...readName(node.name),
    ...(mode === undefined ? {} : { mode }),
    ...readModelSettings(node, readBinding),
  };
}

function readName(input: unknown): { readonly name?: string } {
  if (input === undefined) return {};
  const name = readText(input, 120).trim();
  if (name.length === 0) throw new AgentError("plan_invalid");
  return { name };
}

/** The settings of a model decision and the bound input, each only when saved. */
function readModelSettings(
  node: Record<string, unknown>,
  readBinding: (input: unknown) => AgentPlanBinding,
): Pick<
  AgentPlanDecision,
  "question" | "model" | "output" | "cases" | "input"
> {
  const { output } = node;
  if (
    output !== undefined &&
    output !== "boolean" &&
    output !== "classification"
  )
    throw new AgentError("plan_invalid");
  return {
    ...(node.question === undefined
      ? {}
      : { question: readText(node.question, PLAN_DECISION_QUESTION_LENGTH) }),
    ...(node.model === undefined ? {} : { model: readModel(node.model) }),
    ...(output === undefined ? {} : { output }),
    ...(node.cases === undefined ? {} : { cases: readCases(node.cases) }),
    ...(node.input === undefined
      ? {}
      : { input: readInput(node.input, readBinding) }),
  };
}

/**
 * Parses the decisions saved inside a group or loop.
 *
 * @param input - The untrusted list, absent in a container without decisions.
 * @param readNode - The node reader of the plan.
 */
export function readPlanContainedDecisions(
  input: unknown,
  readNode: (input: unknown) => AgentPlanNode,
): { readonly decisions?: readonly AgentPlanDecision[] } {
  if (input === undefined) return {};
  if (!Array.isArray(input) || input.length > 50)
    throw new AgentError("plan_invalid");
  const decisions = input.map((entry: unknown) => {
    const node = readNode(entry);
    if (node.type !== "decision") throw new AgentError("plan_invalid");
    return node;
  });
  return decisions.length === 0 ? {} : { decisions };
}
