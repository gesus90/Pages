import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import { defaultAgentRunOptions } from "@/definition/AgentConfiguration";

import {
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";

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
    ["name", "modelProfileId", "reasoningEffort", "template"],
  );
  const source = context.agents.find((agent) => agent.id === step.agentId);
  let current =
    step.configuration ?? (source ? copyPlanConfiguration(source) : undefined);
  if (!current)
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: "element_missing",
    });
  if (patch.modelProfileId !== undefined) {
    const model = context.models?.find(
      (entry) => entry.id === patch.modelProfileId,
    );
    if (!model)
      throw new AgentOperationError("INVALID_REQUEST", {
        reason: "parameter_reference_unavailable",
      });
    current = {
      ...current,
      modelProfileId: model.id,
      model: model.model,
      provider: model.provider,
      reasoningEffort:
        current.modelProfileId === model.id
          ? current.reasoningEffort
          : model.reasoningEffort,
      template: {
        ...current.template,
        ...(current.provider === model.provider
          ? {}
          : { run: defaultAgentRunOptions(model.provider) }),
      },
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
  return {
    ...current,
    ...patch,
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
