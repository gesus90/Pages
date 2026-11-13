import { isAcpProvider } from "@/definition/AgentConfiguration";
import {
  PLAN_SWARM_TASK_BINDING,
  PLAN_SWARM_WORKER_LIMIT,
  isPlanSwarmRemote,
  planSwarmWorkerAt,
} from "@/definition/AgentPlanSwarm";

import type { AgentPlanInput } from "@/definition/AgentPlan";
import type {
  AgentPlanSwarm,
  AgentPlanSwarmModel,
  AgentPlanSwarmWorker,
  AgentPlanSwarmWorkerMode,
} from "@/definition/AgentPlanSwarm";
import type { PageAgentModel } from "@/definition/PageAgent";

/** Why a listed model cannot run in a swarm: only models of an ACP connection open sessions. */
export function planSwarmModelRefusal(model: PageAgentModel): boolean {
  return (
    !model.connectionId ||
    model.runnerRoute !== undefined ||
    !isAcpProvider(model.provider)
  );
}

/** The catalog entry of a saved model choice; empty when it is gone or none is chosen. */
export function planSwarmModelId(
  model: AgentPlanSwarmModel | null,
  models: readonly PageAgentModel[],
): string {
  if (!model) return "";
  return (
    models.find(
      (entry) =>
        entry.connectionId === model.connectionId &&
        entry.model === model.model,
    )?.id ?? ""
  );
}

/**
 * The model choice of a catalog entry, keeping the reasoning when the model stays.
 *
 * @returns `null` for an entry that is not an ACP model.
 */
export function planSwarmModelOf(
  id: string,
  models: readonly PageAgentModel[],
  previous: AgentPlanSwarmModel | null,
): AgentPlanSwarmModel | null {
  const model = models.find((entry) => entry.id === id);
  if (!model?.connectionId || !isAcpProvider(model.provider)) return null;
  const isSame =
    previous?.connectionId === model.connectionId &&
    previous.model === model.model;
  return {
    connectionId: model.connectionId,
    provider: model.provider,
    model: model.model,
    reasoningEffort: isSame ? previous.reasoningEffort : null,
  };
}

/** The swarm with a helper count between 1 and 10. */
export function withPlanSwarmCount(
  swarm: AgentPlanSwarm,
  count: number,
): AgentPlanSwarm {
  const bounded = Math.min(PLAN_SWARM_WORKER_LIMIT, Math.max(1, count));
  return { ...swarm, workers: { ...swarm.workers, count: bounded } };
}

/**
 * Switches between one configuration for all helpers and one per helper.
 *
 * @remarks
 * Switching to `individual` fills every helper without its own entry with
 * the shared configuration, so nothing changes until a helper is changed.
 */
export function withPlanSwarmMode(
  swarm: AgentPlanSwarm,
  mode: AgentPlanSwarmWorkerMode,
): AgentPlanSwarm {
  const { count, same } = swarm.workers;
  const individual =
    mode === "individual"
      ? Array.from(
          { length: Math.max(count, swarm.workers.individual.length) },
          (_, index) => swarm.workers.individual[index] ?? same,
        )
      : swarm.workers.individual;
  return { ...swarm, workers: { ...swarm.workers, mode, individual } };
}

/** The swarm with a changed configuration of one helper, by its position from 0. */
export function withPlanSwarmWorker(
  swarm: AgentPlanSwarm,
  index: number,
  worker: AgentPlanSwarmWorker,
): AgentPlanSwarm {
  const individual = Array.from(
    { length: Math.max(swarm.workers.individual.length, index + 1) },
    (_, position) =>
      position === index ? worker : planSwarmWorkerAt(swarm.workers, position),
  );
  return { ...swarm, workers: { ...swarm.workers, individual } };
}

/** The ticket nodes of the plan a swarm can take its task from. */
export function planSwarmTicketChoices(
  draft: AgentPlanInput,
): readonly { readonly id: string; readonly taskId: string }[] {
  return draft.nodes.flatMap((node) =>
    node.type === "task" ? [{ id: node.id, taskId: node.taskId }] : [],
  );
}

/** The ticket node a swarm takes its task from, or `""`. */
export function planSwarmTicketNode(swarm: AgentPlanSwarm): string {
  const binding = swarm.bindings[PLAN_SWARM_TASK_BINDING];
  return binding?.kind === "source" ? binding.nodeId : "";
}

/** The swarm with its task taken from a ticket node, or without one for `""`. */
export function withPlanSwarmTicket(
  swarm: AgentPlanSwarm,
  nodeId: string,
): AgentPlanSwarm {
  const bindings = Object.fromEntries(
    Object.entries(swarm.bindings).filter(
      ([name]) => name !== PLAN_SWARM_TASK_BINDING,
    ),
  );
  return {
    ...swarm,
    task: { source: "ticket" },
    bindings: nodeId
      ? { ...bindings, [PLAN_SWARM_TASK_BINDING]: { kind: "source", nodeId } }
      : bindings,
  };
}

/** Whether the swarm would run on a remote target, which a save refuses. */
export function isPlanSwarmTargetRefused(
  swarm: AgentPlanSwarm,
  draft: AgentPlanInput,
): boolean {
  return isPlanSwarmRemote(swarm, draft);
}
