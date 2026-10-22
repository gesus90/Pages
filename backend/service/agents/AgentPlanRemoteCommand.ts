import { AgentError } from "@/backend/error/AgentErrors";
import {
  planScriptIssues,
  planScriptParameters,
} from "@/definition/AgentPlanScript";
import { planBindings } from "./AgentPlanBindings";
import type {
  RunnerExecution,
  RunnerInterpreter,
} from "@/definition/RunnerExecution";
import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type { AgentPlan, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";
import type { AgentPlanTaskSnapshot } from "./AgentPlanBindings";

type CommandBasis = Omit<RunnerExecution, "program" | "timeoutSeconds">;

/** Resolves only declared text values; remote resource adapters are never invented. */
export function remoteTextInputs(
  plan: AgentPlan,
  step: AgentPlanStep | AgentPlanScript,
  tasks: readonly AgentPlanTaskSnapshot[],
): Readonly<Record<string, string>> {
  const parameters =
    step.type === "script"
      ? planScriptParameters(step)
      : step.configuration?.template.parameters;
  if (!parameters || parameters.some((parameter) => parameter.type !== "text"))
    throw new AgentError("plan_binding_invalid");
  const bindings = planBindings(plan, step, tasks, parameters);
  const inputs: Record<string, string> = {};
  for (const parameter of parameters) {
    const bound = bindings[parameter.name] ?? parameter.defaultValue;
    if (step.bindings[parameter.name]?.kind === "result") continue;
    if (!bound && !parameter.isRequired) continue;
    if (bound?.type !== "text" || (parameter.isRequired && !bound.text.trim()))
      throw new AgentError("plan_binding_invalid");
    inputs[parameter.name] = bound.text;
  }
  return inputs;
}

/** Uses the interpreter selected on this runner, including its immutable executable digest. */
export function remoteScriptCommand(
  step: AgentPlanScript,
  target: AgentPlanRemoteTarget,
  interpreters: readonly RunnerInterpreter[],
  basis: CommandBasis,
): RunnerExecution {
  const interpreter = interpreters.find(
    (entry) =>
      `${target.workspaceId}-${entry.id}` === step.interpreterProfileId,
  );
  if (!interpreter || planScriptIssues(step).length)
    throw new AgentError("plan_script_interpreter_unavailable");
  return {
    ...basis,
    hasOutput: step.outputs.length > 0,
    timeoutSeconds: step.timeoutSeconds,
    program: { kind: "script", interpreter, source: step.content },
  };
}

/** A remote model request uses only its catalog route and has a finite provider deadline. */
export function remoteModelCommand(
  step: AgentPlanStep,
  basis: CommandBasis,
): RunnerExecution {
  const configuration = step.configuration;
  if (!configuration?.runnerRoute || step.completion === "todos")
    throw new AgentError("plan_context_changed");
  return {
    ...basis,
    timeoutSeconds:
      Math.max(1, configuration.template.run?.timeoutMinutes ?? 5) * 60,
    program: {
      kind: "model",
      route: configuration.runnerRoute,
      model: configuration.model,
      prompt: `${configuration.template.markdown}\n\n${step.instruction}`,
    },
  };
}
