import { AgentError } from "@/backend/error/AgentErrors";
import {
  planScriptIssues,
  planScriptParameters,
} from "@/definition/AgentPlanScript";
import { agentRunOptionsFor } from "@/definition/AgentConfiguration";
import { RUNNER_TOOL_PROVIDERS } from "@/definition/RunnerExecution";
import { planBindings } from "./AgentPlanBindings";
import { buildPlanContract, renderPlanAssignment } from "./AgentPlanContract";
import type {
  RunnerExecution,
  RunnerInterpreter,
} from "@/definition/RunnerExecution";
import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type { AgentPlan, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";
import type { AgentPlanTaskSnapshot } from "./AgentPlanBindings";
import type { AgentPlanTicketChecklist } from "./AgentPlanTasks";

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
  tickets: readonly AgentPlanTicketChecklist[] = [],
): RunnerExecution {
  const configuration = step.configuration;
  if (!configuration?.runnerRoute) throw new AgentError("plan_context_changed");
  const route = configuration.runnerRoute;
  if (route.tool) {
    const options = agentRunOptionsFor(
      RUNNER_TOOL_PROVIDERS[route.tool],
      configuration.template.run,
    );
    if (options.access === "workspace_write" || options.browser)
      throw new AgentError("plan_context_changed");
    const isReadOnly = options.access === "read_only";
    const contract = buildPlanContract(step.instruction, tickets, {
      isReadOnly,
      completion: step.completion,
      completionGate: step.completionGate,
    });
    const assignment = renderPlanAssignment({
      contract,
      isReadOnly,
      usesMcp: basis.pagesAccess === 1,
      runnerLabel: route.tool,
      instanceId: step.id,
      directory: basis.workspace,
    });
    return {
      ...basis,
      timeoutSeconds: options.timeoutMinutes * 60,
      program: {
        kind: "cli",
        route,
        model: configuration.model,
        reasoningEffort: configuration.reasoningEffort,
        access: options.access,
        prompt: `${configuration.template.markdown}\n\n${step.instruction}\n\n${assignment}`,
      },
    };
  }
  if (step.completion === "todos") throw new AgentError("plan_context_changed");
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
