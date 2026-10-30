import { AgentError } from "@/backend/error/AgentErrors";

import { bindAgentParameters } from "./AgentParameterBinding";
import {
  remoteParameterResolvers,
  remoteWorkspaceContext,
  requireRemotePromptSize,
} from "./AgentPlanRemoteParameters";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { RunnerExecution } from "@/definition/RunnerExecution";
import type { RemotePlanStep } from "./AgentPlanRemoteExecution";

/** Refuses new CLI work unless the command and live runner agree on the exact result contract. */
export function requireRemoteResultPayload(
  command: RunnerExecution,
  isSupported: () => boolean,
): void {
  if (command.program.kind !== "cli") return;
  if (command.resultPayloadVersion !== 1 || !isSupported())
    throw new AgentError("plan_runner_payload_update_required");
}

/** Resolves predecessor results in the frozen command without changing its result contract. */
export async function resolvedRemoteCommand(
  run: AgentPlanRun,
  remote: RemotePlanStep,
): Promise<RunnerExecution> {
  const inputs = { ...remote.inputs };
  for (const [name, binding] of Object.entries(remote.step.bindings)) {
    if (binding.kind !== "result") continue;
    const result = run.steps.find((entry) => entry.id === binding.stepId);
    if (result?.status !== "succeeded" || result.output === null)
      throw new AgentError("plan_binding_invalid");
    inputs[name] = result.output;
  }
  const command = remote.command;
  if (command.program.kind === "script")
    return {
      ...command,
      revision: run.planRevision,
      sourceRevision: command.revision,
      input: JSON.stringify(inputs),
    };
  if (remote.step.type !== "agent")
    throw new AgentError("configuration_invalid");
  const configuration = remote.step.configuration;
  if (!configuration) throw new AgentError("configuration_invalid");
  const bound = await bindAgentParameters(
    { ...configuration.template, markdown: command.program.prompt },
    {
      ...remote.parameters?.values,
      ...Object.fromEntries(
        Object.entries(inputs)
          .filter(
            ([name]) =>
              !remote.parameters ||
              remote.parameters.values[name]?.type === "text",
          )
          .map(([name, text]) => [name, { type: "text", text }]),
      ),
    },
    remoteParameterResolvers(
      remote.parameters ?? {
        values: {},
        tickets: {},
        wiki: {},
        workspaces: {},
        resources: [],
        assets: [],
      },
    ),
  );
  const prompt =
    (remote.recoveryContext ?? "") +
    bound.markdown +
    remoteWorkspaceContext(remote.parameters);
  requireRemotePromptSize(remote.step, prompt);
  return {
    ...command,
    revision: run.planRevision,
    sourceRevision: command.revision,
    program: {
      ...command.program,
      prompt,
    },
  };
}
