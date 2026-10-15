import { AgentError } from "@/backend/error/AgentErrors";

import { bindAgentParameters } from "./AgentParameterBinding";
import { planBindings } from "./AgentPlanBindings";
import { validatePlanParameterContext } from "./AgentPlanParameterContext";
import {
  groupRuntimeFields,
  requireCompatibleFields,
  validateGroupRuntimes,
} from "./AgentPlanGroupRuntime";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type {
  AgentParameterService,
  PreparedAgentParameters,
} from "./AgentParameterService";
import type {
  AgentPlanSnapshot,
  AgentPlanStepSnapshot,
} from "./AgentPlanSnapshot";
import type { AgentPlanTasks } from "./AgentPlanTasks";

interface GroupParameterDependencies {
  readonly parameters: Pick<AgentParameterService, "prepare">;
  readonly tasks: Pick<AgentPlanTasks, "snapshot">;
}

/** Resolves each boundary once when its predecessor has succeeded, before any group turn. */
export async function prepareGroupParameters(
  dependencies: GroupParameterDependencies,
  run: AgentPlanRun,
  snapshot: AgentPlanSnapshot,
  groupId: string,
): Promise<AgentPlanSnapshot> {
  const group = snapshot.groups?.find((entry) => entry.id === groupId);
  const first = snapshot.steps.find((entry) => entry.groupId === groupId);
  if (!group || !first) throw new AgentError("plan_invalid");
  const tasks = await Promise.all(
    snapshot.plan.nodes.flatMap((node) =>
      node.type === "task" &&
      Object.values(group.bindings).some(
        (binding) => binding.kind === "source" && binding.nodeId === node.id,
      )
        ? [
            dependencies.tasks.snapshot(
              run.userId,
              snapshot.plan.projectId,
              node.taskId,
            ),
          ]
        : [],
    ),
  );
  const template = {
    ...first.template,
    markdown: "",
    parameters: group.parameters,
    directoryParameter: null,
  };
  const shared = structuredClone(
    await dependencies.parameters.prepare(
      run.userId,
      {
        agentId: first.step.agentId,
        personalAgentId: first.step.personalAgentId,
        workspaceId: snapshot.plan.workspaceId,
        configuration: first.step.configuration,
      },
      planBindings(
        snapshot.plan,
        { ...first.step, bindings: group.bindings },
        tasks,
        group.parameters,
      ),
      template,
    ),
  );
  const steps: AgentPlanStepSnapshot[] = [];
  for (const step of snapshot.steps)
    steps.push(
      step.groupId === groupId
        ? await bindGroupStep(group, step, shared)
        : step,
    );
  validateGroupRuntimes([group], steps);
  return { ...snapshot, steps };
}

async function bindGroupStep(
  group: AgentPlanGroup,
  step: AgentPlanStepSnapshot,
  shared: PreparedAgentParameters,
): Promise<AgentPlanStepSnapshot> {
  const child = group.steps.find((entry) => entry.id === step.step.id);
  if (!child) throw new AgentError("plan_invalid");
  const values = { ...step.prepared.parameters.values };
  for (const [name, binding] of Object.entries(child.bindings)) {
    if (binding.kind !== "source") continue;
    const port = group.parameters.find((entry) => entry.id === binding.nodeId);
    if (!port) throw new AgentError("plan_binding_invalid");
    values[name] = shared.parameters.values[port.name] ?? null;
  }
  const references = new Map(
    step.prepared.references.map((entry) => [entry.id, entry]),
  );
  const workspaceIds = new Set(
    Object.values(values).flatMap((bound) =>
      bound?.type === "workspace" ? [bound.workspaceId] : [],
    ),
  );
  for (const reference of shared.references)
    if (workspaceIds.has(reference.id)) references.set(reference.id, reference);
  const prepared = {
    ...step.prepared,
    references: [...references.values()],
    tickets: { ...step.prepared.tickets, ...shared.tickets },
    wiki: { ...step.prepared.wiki, ...shared.wiki },
  };
  const parameters = await bindAgentParameters(step.template, values, {
    ticket: async (id) => {
      const ticket = prepared.tickets[id];
      if (!ticket) throw new AgentError("parameter_ticket_unavailable");
      return ticket;
    },
    workspace: async (id) => {
      const workspace = references.get(id);
      if (!workspace) throw new AgentError("plan_context_changed");
      return workspace;
    },
    wiki: async (id) => {
      const page = prepared.wiki[id];
      if (!page) throw new AgentError("plan_binding_invalid");
      return page;
    },
  });
  const directoryValue = step.template.directoryParameter
    ? parameters.values[step.template.directoryParameter]
    : null;
  const updated = {
    ...step,
    prepared: {
      ...prepared,
      parameters,
      directory:
        directoryValue?.type === "workspace"
          ? (references.get(directoryValue.workspaceId) ?? null)
          : step.prepared.directory,
    },
  };
  validatePlanParameterContext(step, updated.prepared);
  requireCompatibleFields(
    step.step.id,
    groupRuntimeFields(updated),
    groupRuntimeFields(step),
  );
  return updated;
}
