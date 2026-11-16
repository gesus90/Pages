import { planGroupAgents } from "@/definition/AgentPlanGroupLoop";
import { AgentError } from "@/backend/error/AgentErrors";
import { agentRunOptionsFor } from "@/definition/AgentConfiguration";

import { resolvedRemoteCommand } from "./AgentPlanRemoteResolvedCommand";

import type { RemotePlanStep } from "./AgentPlanRemoteExecution";
import type { PreparedPlanStep } from "./AgentPlanStepStart";
import type {
  AgentPlanSnapshot,
  AgentPlanStepSnapshot,
} from "./AgentPlanSnapshot";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { RemotePlanParameters } from "./AgentPlanRemoteParameters";

/** Represents remote models in the same engine/session graph as local models. */
export function remoteSessionSnapshot(
  remote: RemotePlanStep,
  plan: AgentPlanSnapshot["plan"],
  membership: { readonly groupId?: string; readonly loopId?: string },
): AgentPlanStepSnapshot {
  const step = remote.step;
  if (step.type !== "agent" || !step.configuration)
    throw new AgentError("configuration_invalid");
  const configuration = step.configuration;
  const workspace = {
    id: remote.target.workspaceId,
    name: remote.target.workspaceName,
    path: remote.target.path,
    revision: remote.target.workspaceRevision,
    directoryIdentity: `${remote.target.connectionId}:${remote.target.workspaceRevision}`,
    projectId: plan.projectId,
    github: null,
  };
  return {
    step,
    ...membership,
    remoteTarget: remote.target,
    name: configuration.name,
    connectionId: remote.command.agentAccount?.id ?? remote.target.connectionId,
    revision: configuration.revision,
    provider: configuration.provider ?? "openrouter",
    model: configuration.model,
    reasoningEffort: configuration.reasoningEffort,
    template: configuration.template,
    taskIds: [],
    taskVersions: {},
    prepared: remotePrepared(remote, plan, workspace),
  };
}

function remotePrepared(
  remote: RemotePlanStep,
  plan: AgentPlanSnapshot["plan"],
  workspace: AgentPlanStepSnapshot["prepared"]["workspace"],
): AgentPlanStepSnapshot["prepared"] {
  const parameters = remote.parameters;
  return {
    workspace,
    directory: workspace,
    references: Object.values(parameters?.workspaces ?? {}).map((entry) => ({
      id: entry.workspaceId,
      path: entry.path,
      revision: entry.workspaceRevision,
      directoryIdentity: `${entry.connectionId}:${entry.workspaceRevision}`,
      projectId: plan.projectId,
      github: null,
    })),
    tickets: parameters?.tickets ?? {},
    wiki: parameters?.wiki ?? {},
    parameters: {
      markdown: "",
      directory: workspace.path,
      values: parameters?.values ?? {},
      wikiVersions: {},
      tickets: parameters?.tickets ?? {},
      assetInputs: [],
    },
  };
}

/** Builds a runner input from frozen remote material after current catalog/resource authorization. */
export async function remoteSessionInput(
  run: AgentPlanRun,
  source: AgentPlanStepSnapshot,
  remote: RemotePlanStep,
): Promise<PreparedPlanStep> {
  const original = remote.command.program;
  if (original.kind === "script" || original.kind === "api")
    throw new AgentError("configuration_invalid");
  const command = await resolvedRemoteCommand(run, {
    ...remote,
    step: source.step,
    command: {
      ...remote.command,
      program: {
        ...original,
        prompt: `${source.template.markdown}\n\n${source.step.instruction}`,
      },
    },
    parameters: remote.parameters
      ? { ...remote.parameters, values: source.prepared.parameters.values }
      : undefined,
    inputs: {
      ...remote.inputs,
      ...Object.fromEntries(
        Object.entries(source.prepared.parameters.values).flatMap(
          ([name, bound]) =>
            bound?.type === "text" ? [[name, bound.text]] : [],
        ),
      ),
    },
  });
  if (command.program.kind === "script" || command.program.kind === "api")
    throw new AgentError("configuration_invalid");
  return {
    options: agentRunOptionsFor(source.provider, source.template.run),
    definition: null,
    instruction: source.step.instruction,
    input: {
      userId: run.userId,
      directory: command.workspace,
      prompt: command.program.prompt,
      runnerCommand: command,
      runnerTarget: remote.target,
      runnerParameters: remote.parameters,
      agent: {
        model: source.model,
        reasoningEffort: source.reasoningEffort,
        connection: {
          id: remote.target.connectionId,
          name: remote.target.connectionName,
          provider: source.provider,
          isActive: true,
          hasApiKey: false,
          testModel: null,
          reasoningEffort: source.reasoningEffort,
          cliLoggedInAt: null,
          cliAccountLabel: null,
          updatedAt: new Date().toISOString(),
        },
      },
    },
  };
}

/** Renames shared resource manifests to each member's declared parameter without repinning files. */
export function remoteGroupParameters(
  group: AgentPlanGroup,
  own: RemotePlanStep,
  shared: RemotePlanParameters,
): RemotePlanParameters {
  const previous = own.parameters;
  const child = planGroupAgents(group).find(
    (entry) => entry.id === own.step.id,
  );
  if (!previous || !child) throw new AgentError("plan_context_changed");
  let assets = [...previous.assets];
  let resources = [...previous.resources];
  const values = { ...previous.values };
  for (const [name, binding] of Object.entries(child.bindings)) {
    if (binding.kind !== "source") continue;
    const port = group.parameters.find((entry) => entry.id === binding.nodeId);
    if (!port) continue;
    values[name] = shared.values[port.name] ?? null;
    assets = [
      ...assets.filter((asset) => asset.file.parameter !== name),
      ...shared.assets
        .filter((asset) => asset.file.parameter === port.name)
        .map((asset) => ({
          ...asset,
          file: { ...asset.file, parameter: name },
        })),
    ];
    resources = [
      ...resources.filter((resource) => resource.parameter !== name),
      ...shared.resources
        .filter((resource) => resource.parameter === port.name)
        .map((resource) => ({ ...resource, parameter: name })),
    ];
  }
  return {
    values,
    assets,
    resources,
    tickets: { ...previous.tickets, ...shared.tickets },
    wiki: { ...previous.wiki, ...shared.wiki },
    workspaces: { ...previous.workspaces, ...shared.workspaces },
  };
}
