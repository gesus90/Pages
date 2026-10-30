import { planRecoveryTerms } from "./AgentPlanRecoveryPrompt";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type {
  AgentPlanSnapshot,
  AgentPlanRecoveryDirective,
} from "../AgentPlanSnapshot";

/** Supplies bounded prior business context while keeping the complete original output and checkpoints in history. */
export function recoveredAgentContext(
  run: AgentPlanRun,
  ids: readonly string[],
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    run.steps
      .filter((step) => ids.includes(step.id))
      .map((step) => [
        step.id,
        JSON.stringify({
          sourceRunId: run.id,
          stepId: step.id,
          previousOutput: step.output?.slice(0, 16000) ?? null,
          isOutputExcerpt: (step.output?.length ?? 0) > 16000,
          error: step.error,
          acceptance: step.session?.acceptance,
          previousSessionId: step.session?.sessionId ?? null,
          historyRetained: true,
        }),
      ]),
  );
}

/** Gives local and remote replacement sessions the same preserved context and honest session-change notice. */
export function withRecoveredAgentContext(
  snapshot: AgentPlanSnapshot,
  recovery: AgentPlanRecoveryDirective,
): AgentPlanSnapshot {
  const basis = { ...snapshot, recovery };
  return {
    ...basis,
    remoteSteps: snapshot.remoteSteps?.map((remote) => {
      if (remote.command.program.kind === "script") return remote;
      const terms = planRecoveryTerms(basis, remote.step.id, {
        sessionGroup: undefined,
        loop: null,
      });
      if (!terms.note) return remote;
      return { ...remote, recoveryContext: terms.note };
    }),
  };
}
