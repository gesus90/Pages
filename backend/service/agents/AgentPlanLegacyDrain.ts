import { AgentError } from "@/backend/error/AgentErrors";

import { planSessionReach } from "./AgentPlanSessionAccess";

import type {
  PlanExecution,
  PlanSession,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanSessionGrants } from "./AgentPlanSessionAccess";
import type { NodeRun } from "./AgentPlanStepContext";

/** Finishes the existing legacy turn, then continues its native thread through Runner only. */
export function drainLegacyPlanSession(
  legacy: PlanSession,
  node: NodeRun,
  dependencies: {
    readonly execution: PlanExecution;
    readonly access: AgentPlanSessionGrants;
  },
): PlanSession {
  let current = legacy;
  let hasUpgraded = false;
  return {
    turn: legacy.turn,
    get isDurable(): boolean {
      return current.isDurable === true;
    },
    get isDetached(): boolean {
      return current.isDetached === true;
    },
    detach: () => current.detach?.(),
    setPaused: async (isPaused) => {
      await current.setPaused?.(isPaused);
    },
    close: () => current.close(),
    next: async (input, signal, observer) => {
      if (hasUpgraded) {
        if (!current.next) throw new AgentError("plan_session_unavailable");
        return current.next(input, signal, observer);
      }
      const turn = await legacy.turn;
      const closed = await legacy.close();
      const record = node.record;
      if (!closed.isConfirmed || !turn.sessionId || !record?.requested.options)
        throw new AgentError("plan_session_unavailable");
      const options = record.requested.options;
      const context = input.resourceContext;
      if (!context || !input.directory)
        throw new AgentError("plan_context_changed");
      const mcp = await dependencies.access.grant({
        userId: input.userId,
        runId: context.runId,
        stepId: context.sessionScopeId ?? context.stepId,
        instanceId: record.instanceId,
        tickets: record.contract?.tickets ?? [],
        lifetimeMs: 0,
        reach: planSessionReach(input.agent.connection.provider, options),
        canSetStatus: node.step.step.completion === "todos",
      });
      current = await dependencies.execution.open(
        {
          ...input,
          directory: input.directory,
          instanceId: record.instanceId,
          options,
          mcp,
          resumeSessionId: turn.sessionId,
        },
        signal,
        observer,
      );
      hasUpgraded = true;
      return current.turn;
    },
  };
}
