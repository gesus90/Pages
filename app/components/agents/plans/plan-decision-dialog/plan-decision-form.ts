import { isAcpProvider } from "@/definition/AgentConfiguration";
import {
  planConditionSource,
  planContainedEdges,
} from "@/definition/AgentPlanBranching";
import {
  setPlanDecisionCondition,
  setPlanDecisionInput,
} from "@/definition/AgentPlanBranchingEdit";
import {
  PLAN_DECISION_CASE_NAME_LENGTH,
  planDecisionCasePort,
  planDecisionMode,
  planDecisionOutput,
} from "@/definition/AgentPlanDecision";
import {
  findPlanDecision,
  replacePlanDecision,
  withoutPlanEdges,
} from "@/definition/AgentPlanDecisionEdit";
import { expandPlanGroups } from "@/definition/AgentPlanGroup";
import { expandPlanLoops } from "@/definition/AgentPlanLoop";

import { planNodeLabel } from "../plan-layout";

import type { TFunction } from "i18next";
import type {
  AgentPlanBinding,
  AgentPlanDecision,
  AgentPlanInput,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type {
  AgentPlanDecisionCase,
  AgentPlanDecisionMode,
  AgentPlanDecisionOutput,
} from "@/definition/AgentPlanDecision";
import type { PageAgentModel } from "@/definition/PageAgent";

/**
 * What the decision dialog edits before Apply.
 *
 * @remarks
 * `input` encodes the data input: an agent's id for its boolean result (as
 * before PAGE-286), `source:<id>` for a parameter or ticket, `result:<id>`
 * for a text result, and an empty text for none.
 */
export interface PlanDecisionForm {
  readonly name: string;
  readonly mode: AgentPlanDecisionMode;
  readonly input: string;
  readonly question: string;
  readonly modelId: string;
  readonly output: AgentPlanDecisionOutput;
  readonly cases: readonly AgentPlanDecisionCase[];
}

/** One entry of the data input choice. */
export interface PlanDecisionInputChoice {
  readonly value: string;
  readonly label: string;
}

const SOURCE_PREFIX = "source:";
const RESULT_PREFIX = "result:";

/** The models a decision may ask: those Pages offers over its own ACP connections. */
export function planDecisionModels(
  sources: AgentPlanSources,
): readonly PageAgentModel[] {
  return sources.models ?? [];
}

/** Why a listed model cannot decide: only a model of an ACP connection runs a decision session. */
export function planDecisionModelRefusal(model: PageAgentModel): boolean {
  return (
    !model.connectionId ||
    model.runnerRoute !== undefined ||
    !isAcpProvider(model.provider)
  );
}

/** The encoded data input of a decision, as the dialog's choice names it. */
export function planDecisionInputValue(
  draft: AgentPlanInput,
  decision: AgentPlanDecision,
): string {
  const agent = planConditionSource(draft, decision.id);
  if (agent !== null) return agent;
  const input = decision.input;
  if (input?.kind === "source") return `${SOURCE_PREFIX}${input.nodeId}`;
  return input?.kind === "result" ? `${RESULT_PREFIX}${input.stepId}` : "";
}

/** The form of a decision as it is saved. */
export function planDecisionFormOf(
  draft: AgentPlanInput,
  decision: AgentPlanDecision,
  models: readonly PageAgentModel[],
): PlanDecisionForm {
  const saved = decision.model;
  return {
    name: decision.name ?? "",
    mode: planDecisionMode(decision),
    input: planDecisionInputValue(draft, decision),
    question: decision.question ?? "",
    modelId:
      models.find(
        (model) =>
          saved !== undefined &&
          model.connectionId === saved.connectionId &&
          model.model === saved.model,
      )?.id ?? "",
    output: decision.output ?? "boolean",
    cases: decision.cases ?? [],
  };
}

/**
 * The sources the data input of a decision can read in its mode.
 *
 * @remarks
 * A boolean decision reads an agent's boolean result or a boolean parameter;
 * a model decision a ticket or the text result of an agent or script. An
 * agent keeps its plain id as the value, as the choice always had.
 */
export function planDecisionInputChoices(
  draft: AgentPlanInput,
  sources: AgentPlanSources,
  mode: AgentPlanDecisionMode,
  translate: TFunction,
): readonly PlanDecisionInputChoice[] {
  const nodes = expandPlanLoops(expandPlanGroups(draft)).nodes;
  const choices = nodes.flatMap((node): PlanDecisionInputChoice[] => {
    const name = planNodeLabel(node, sources) || node.id;
    if (mode === "boolean") {
      if (node.type === "agent")
        return [
          {
            value: node.id,
            label: translate("plans.decision.dialog.agentBoolean", { name }),
          },
        ];
      return node.type === "parameter" && node.format === "boolean"
        ? [
            {
              value: `${SOURCE_PREFIX}${node.id}`,
              label: translate("plans.decision.dialog.parameter", { name }),
            },
          ]
        : [];
    }
    if (node.type === "task")
      return [
        {
          value: `${SOURCE_PREFIX}${node.id}`,
          label: translate("plans.decision.dialog.ticket", { name }),
        },
      ];
    const isResult =
      node.type === "agent" ||
      (node.type === "script" && node.outputs.length === 1);
    return isResult
      ? [
          {
            value: `${RESULT_PREFIX}${node.id}`,
            label: translate("plans.decision.dialog.result", { name }),
          },
        ]
      : [];
  });
  return [
    { value: "", label: translate("plans.decision.dialog.none") },
    ...choices,
  ];
}

/** Why the value list cannot be applied: an empty, too long or repeated name; `null` when it can. */
export function planDecisionCaseNameProblem(
  cases: readonly AgentPlanDecisionCase[],
): "empty" | "length" | "duplicate" | null {
  const names = cases.map((entry) => entry.name.trim());
  if (names.some((name) => name.length === 0)) return "empty";
  if (names.some((name) => name.length > PLAN_DECISION_CASE_NAME_LENGTH))
    return "length";
  const unique = new Set(names.map((name) => name.toLowerCase()));
  return unique.size === names.length ? null : "duplicate";
}

/** Whether an output of the decision has a connection in the draft. */
export function isPlanDecisionCaseConnected(
  draft: AgentPlanInput,
  decisionId: string,
  caseId: string,
): boolean {
  const port = planDecisionCasePort(caseId);
  return planContainedEdges(draft).some(
    (edge) => edge.from === decisionId && edge.fromPort === port,
  );
}

function inputBinding(value: string): AgentPlanBinding | null {
  if (value.startsWith(SOURCE_PREFIX))
    return { kind: "source", nodeId: value.slice(SOURCE_PREFIX.length) };
  if (value.startsWith(RESULT_PREFIX))
    return { kind: "result", stepId: value.slice(RESULT_PREFIX.length) };
  return null;
}

/** The plan with the data input the form chose; an unchanged input stays as it is. */
function withInput(
  plan: AgentPlanInput,
  decision: AgentPlanDecision,
  value: string,
): AgentPlanInput {
  if (value === planDecisionInputValue(plan, decision)) return plan;
  if (value === "") return setPlanDecisionInput(plan, decision.id, null);
  const binding = inputBinding(value);
  return binding
    ? setPlanDecisionInput(plan, decision.id, binding)
    : setPlanDecisionCondition(plan, decision.id, value);
}

/** The model a decision asks, when the chosen one runs over an ACP connection. */
function modelSetting(
  model: PageAgentModel | undefined,
): Pick<AgentPlanDecision, "model"> {
  if (!model?.connectionId || !isAcpProvider(model.provider)) return {};
  return {
    model: {
      connectionId: model.connectionId,
      provider: model.provider,
      model: model.model,
      reasoningEffort: null,
    },
  };
}

/**
 * Applies the form to the draft: the settings, the data input and the connections of deleted values.
 *
 * @param plan - The draft.
 * @param decision - The decision the dialog opened.
 * @param input - The form and the models it chose from.
 * @returns The draft with the changed decision. A value that was deleted
 * after the person confirmed it takes its connection with it; a renamed
 * value keeps its connection, because the port names its stable id.
 */
export function appliedPlanDecisionForm(
  plan: AgentPlanInput,
  decision: AgentPlanDecision,
  input: {
    readonly form: PlanDecisionForm;
    readonly models: readonly PageAgentModel[];
  },
): AgentPlanInput {
  const { form } = input;
  const current = findPlanDecision(plan, decision.id)?.decision ?? decision;
  const model = input.models.find((entry) => entry.id === form.modelId);
  const name = form.name.trim();
  const cases = form.cases.map((entry) => ({
    ...entry,
    name: entry.name.trim(),
  }));
  const removed = new Set(
    (current.cases ?? [])
      .filter((entry) => !cases.some((kept) => kept.id === entry.id))
      .map((entry) => planDecisionCasePort(entry.id)),
  );
  const next: AgentPlanDecision = {
    id: current.id,
    type: "decision",
    x: current.x,
    y: current.y,
    ...(name === "" ? {} : { name }),
    ...(current.input ? { input: current.input } : {}),
    // Defaults stay unwritten, so a boolean decision keeps the shape it was saved in.
    ...(form.mode === "model" || current.mode !== undefined
      ? { mode: form.mode }
      : {}),
    ...(form.question.trim() === "" ? {} : { question: form.question }),
    ...modelSetting(model),
    ...(form.output === "classification" || current.output !== undefined
      ? { output: form.output }
      : {}),
    ...(cases.length > 0 || current.cases !== undefined ? { cases } : {}),
  };
  const replaced = withoutPlanEdges(
    replacePlanDecision(plan, next),
    (edge) => edge.from === decision.id && removed.has(edge.fromPort),
  );
  return withInput(replaced, next, form.input);
}

/** Whether the form describes a classification, whose value list matters. */
export function isPlanDecisionClassification(form: PlanDecisionForm): boolean {
  return planDecisionOutput(form) === "classification";
}
