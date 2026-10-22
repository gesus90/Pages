import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import { defaultAgentRunOptions } from "@/definition/AgentConfiguration";
import {
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanChangeContext } from "./AgentPlanStructureChanges";

/** Merges only named configuration fields; model facts come from the current authorized source catalog. */
export function patchPlanConfiguration(
  step: AgentPlanStep,
  input: unknown,
  context: AgentPlanChangeContext,
): unknown {
  const patch = readParameterRecord(input);
  requireParameterKeys(
    patch,
    [],
    [
      "name",
      "modelProfileId",
      "connectionId",
      "model",
      "reasoningEffort",
      "template",
    ],
  );
  const source = context.agents.find((agent) => agent.id === step.agentId);
  let current =
    step.configuration ?? (source ? copyPlanConfiguration(source) : undefined);
  if (!current)
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: "element_missing",
    });
  if (
    patch.modelProfileId !== undefined ||
    patch.connectionId !== undefined ||
    patch.model !== undefined
  ) {
    const model = selectedPlanModel(patch, context);
    if (!model)
      throw new AgentOperationError("INVALID_REQUEST", {
        reason: "parameter_reference_unavailable",
      });
    current = {
      ...current,
      modelProfileId: model.id,
      connectionId: model.connectionId,
      runnerRoute: model.runnerRoute,
      model: model.model,
      provider: model.provider,
      reasoningEffort: current.reasoningEffort,
    };
  }
  const template =
    patch.template === undefined ? {} : readParameterRecord(patch.template);
  requireParameterKeys(
    template,
    [],
    ["markdown", "parameters", "directoryParameter", "run"],
  );
  const run =
    template.run === undefined ? null : readParameterRecord(template.run);
  if (run)
    requireParameterKeys(
      run,
      [],
      ["access", "shell", "web", "timeoutMinutes", "browser"],
    );
  const contentPatch = Object.fromEntries(
    Object.entries(patch).filter(
      ([key]) => !["connectionId", "model", "modelProfileId"].includes(key),
    ),
  );
  return {
    ...current,
    ...contentPatch,
    template: {
      ...current.template,
      ...template,
      ...(run
        ? {
            run: {
              ...(current.template.run ??
                (current.provider
                  ? defaultAgentRunOptions(current.provider)
                  : {})),
              ...run,
            },
          }
        : {}),
    },
  };
}

/** Resolves an explicit connection/model pair, retaining old selection keys as an API alias. */
export function selectedPlanModel(
  input: unknown,
  context: AgentPlanChangeContext,
): PageAgentModel {
  const patch = readParameterRecord(input);
  const model = context.models?.find((entry) =>
    patch.connectionId !== undefined || patch.model !== undefined
      ? entry.connectionId === patch.connectionId && entry.model === patch.model
      : entry.id === patch.modelProfileId,
  );
  if (!model)
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: "parameter_reference_unavailable",
    });
  return model;
}
