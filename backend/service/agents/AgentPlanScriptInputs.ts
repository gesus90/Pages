import { AgentError } from "@/backend/error/AgentErrors";
import { PLAN_SCRIPT_BYTES } from "@/definition/AgentPlanScript";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanScriptSnapshot } from "./AgentPlanScriptPreparation";

/** Serializes exactly the declared inputs; only successful explicit bindings of this run supply results. */
export function scriptInputJson(
  run: AgentPlanRun,
  script: AgentPlanScriptSnapshot,
): string {
  const entries: [string, string][] = [];
  for (const input of script.step.inputs) {
    const binding = script.step.bindings[input.name];
    let text = Object.hasOwn(script.inputs, input.name)
      ? script.inputs[input.name]
      : undefined;
    if (binding?.kind === "result") {
      const result = run.steps.find((step) => step.id === binding.stepId);
      if (result?.status !== "succeeded" || result.output === null)
        throw new AgentError("plan_binding_invalid");
      text = result.output;
    }
    if (text === undefined) {
      if (input.isRequired) throw new AgentError("plan_script_input_required");
      continue;
    }
    if (input.isRequired && text.trim() === "")
      throw new AgentError("plan_script_input_required");
    entries.push([input.name, text]);
  }
  const json = JSON.stringify(Object.fromEntries(entries));
  if (Buffer.byteLength(json, "utf8") > PLAN_SCRIPT_BYTES.input)
    throw new AgentError("plan_script_input_limit");
  return json;
}
