import { readPlanConfiguration } from "@/backend/agents/AgentPlanConfigurationInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import { effectivePlanTarget } from "@/definition/AgentPlanTarget";

import { PLAN_NOTATION_AUTOMATIC } from "./PlanNotationAgent";
import { isSamePlanValue } from "./PlanNotationEquality";
import { jsonEntry, textEntry, wordEntry } from "./PlanNotationFormat";

import type {
  AgentPlanInput,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { AgentPlanExecutionTarget } from "@/definition/AgentPlanExecution";
import type { PlanNotationEntry } from "./PlanNotationFormat";
import type { PlanNotationNames } from "./PlanNotationNames";

/** What the writer of one plan works with. */
export interface PlanNotationWriterContext {
  readonly names: PlanNotationNames;
  readonly sources: AgentPlanSources;
  readonly plan: AgentPlanInput;
}

/** A configuration as the plan reader stores it, or `null` when it does not read. */
function normalized(configuration: unknown): AgentPlanConfiguration | null {
  try {
    return readPlanConfiguration(configuration);
  } catch (error: unknown) {
    if (error instanceof AgentError) return null;
    throw error;
  }
}

/**
 * Writes the execution target of the plan or a node: `local`, a remote workspace by name, or JSON.
 *
 * @param target - The stored target, or absent.
 * @param names - Names a remote workspace where its name is unique.
 */
export function planNotationTargetEntries(
  target: AgentPlanExecutionTarget | undefined,
  names: PlanNotationNames,
): readonly PlanNotationEntry[] {
  if (target === undefined) return [];
  if (target.kind === "local") return [wordEntry("target", "local")];
  const name = names.remoteTargetName(target.workspaceId);
  return name === target.workspaceId || name === "local"
    ? [jsonEntry("executionTarget", target)]
    : [wordEntry("target", name)];
}

function agentEntries(
  step: AgentPlanStep,
  context: PlanNotationWriterContext,
): readonly PlanNotationEntry[] {
  const name =
    step.agentId === "" ? null : context.names.agentName(step.agentId);
  return name === null
    ? [textEntry("agentId", step.agentId)]
    : [wordEntry("agent", name)];
}

function personalEntries(
  step: AgentPlanStep,
  context: PlanNotationWriterContext,
): readonly PlanNotationEntry[] {
  if (step.personalAgentId === null) return [];
  const name =
    step.personalAgentId === ""
      ? null
      : context.names.personalAgentName(step.agentId, step.personalAgentId);
  return name === null || name === PLAN_NOTATION_AUTOMATIC
    ? [textEntry("personalAgentId", step.personalAgentId)]
    : [wordEntry("personalAgent", name)];
}

function gateEntries(step: AgentPlanStep): readonly PlanNotationEntry[] {
  const gate = step.completionGate;
  if (gate === undefined) return [];
  const isListable = gate.requiredChecks.every(
    (check) => check !== "" && check === check.trim() && !check.includes(","),
  );
  return isListable
    ? [textEntry("checks", gate.requiredChecks.join(","))]
    : [jsonEntry("completionGate", gate)];
}

/**
 * The short forms that turn the agent's current copy into the stored one, or `null`.
 *
 * @remarks
 * Only a model offered for the node's target, the reasoning level and the
 * name can be said briefly; any other difference needs the whole copy.
 */
function configurationOverrides(
  stored: AgentPlanConfiguration,
  fresh: AgentPlanConfiguration,
  input: {
    readonly names: PlanNotationNames;
    readonly target: AgentPlanExecutionTarget;
  },
): readonly PlanNotationEntry[] | null {
  const entries: PlanNotationEntry[] = [];
  let candidate = fresh;
  if (
    stored.modelProfileId !== fresh.modelProfileId ||
    stored.model !== fresh.model
  ) {
    const model = input.names.findModel(input.target, stored.modelProfileId);
    const short = input.names.modelName(input.target, stored.modelProfileId);
    if (!model || !short) return null;
    candidate = {
      ...candidate,
      runnerRoute: model.runnerRoute,
      modelProfileId: model.id,
      connectionId: model.connectionId,
      model: model.model,
      provider: model.provider,
    };
    entries.push(wordEntry("model", short.model));
    if (short.provider !== null)
      entries.push(wordEntry("provider", short.provider));
  }
  if (stored.reasoningEffort !== candidate.reasoningEffort) {
    candidate = { ...candidate, reasoningEffort: stored.reasoningEffort };
    entries.push(wordEntry("reasoning", stored.reasoningEffort ?? ""));
  }
  if (stored.name !== candidate.name) {
    candidate = { ...candidate, name: stored.name };
    entries.push(textEntry("name", stored.name));
  }
  return isSamePlanValue(normalized(candidate), stored) ? entries : null;
}

function configurationEntries(
  step: AgentPlanStep,
  context: PlanNotationWriterContext,
): readonly PlanNotationEntry[] {
  const stored = step.configuration;
  if (stored === undefined) return [];
  const agent = context.sources.agents.find(
    (entry) => entry.id === step.agentId,
  );
  const fresh = agent ? normalized(copyPlanConfiguration(agent)) : null;
  const overrides =
    fresh === null
      ? null
      : configurationOverrides(stored, fresh, {
          names: context.names,
          target: effectivePlanTarget(step, context.plan),
        });
  return overrides ?? [jsonEntry("configuration", stored)];
}

/**
 * Writes the fields of an agent node, without its type and bindings.
 *
 * @param step - The stored agent node.
 * @param context - Names agents, models and targets.
 * @returns Short forms where they read back to the same field, long forms otherwise.
 */
export function planNotationAgentEntries(
  step: AgentPlanStep,
  context: PlanNotationWriterContext,
): readonly PlanNotationEntry[] {
  return [
    ...agentEntries(step, context),
    ...personalEntries(step, context),
    ...(step.instruction === ""
      ? []
      : [textEntry("instruction", step.instruction)]),
    ...planNotationTargetEntries(step.executionTarget, context.names),
    ...(step.completion === "todos" ? [wordEntry("completion", "todos")] : []),
    ...gateEntries(step),
    ...(step.role ? [wordEntry("role", step.role)] : []),
    ...configurationEntries(step, context),
  ];
}
