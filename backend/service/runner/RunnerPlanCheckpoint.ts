import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanCheckpointInput } from "@/definition/AgentPlanRecovery";

/** Converts a verified remote completion into the existing immutable Pages checkpoint contract. */
export function runnerPlanCheckpoint(
  run: AgentPlanRun,
  snapshot: unknown,
  step: AgentPlanStepResult,
): AgentPlanCheckpointInput {
  const execution = step.execution;
  if (!execution || !step.remote)
    throw new Error("Runner execution identity missing");
  const basis = readAgentObject(snapshot);
  const steps: readonly unknown[] = Array.isArray(basis.steps)
    ? basis.steps
    : [];
  const remoteSteps: readonly unknown[] = Array.isArray(basis.remoteSteps)
    ? basis.remoteSteps
    : [];
  const pinned = readAgentObject(
    [...steps, ...remoteSteps].find(
      (entry) => readAgentObject(readAgentObject(entry).step).id === step.id,
    ),
  );
  const node = readAgentObject(pinned.step);
  const bindings = readAgentObject(node.bindings);
  const plan = readAgentObject(basis.plan);
  const edges: readonly unknown[] = Array.isArray(plan.edges) ? plan.edges : [];
  return {
    schemaVersion: 1,
    runId: run.id,
    planId: run.planId,
    planRevision: run.planRevision,
    stepId: step.id,
    completedAt: step.remote.endedAt ?? new Date().toISOString(),
    snapshotDigest: planContentDigest(snapshot),
    workflow: { engine: "pages", runId: null },
    completedStepIds: run.steps
      .filter((entry) => entry.status === "succeeded")
      .map((entry) => entry.id),
    pendingStepIds: run.steps
      .filter((entry) => entry.status !== "succeeded")
      .map((entry) => entry.id),
    dependencies: edges
      .map(readAgentObject)
      .filter((edge) => edge.to === step.id)
      .map((edge) => {
        if (typeof edge.from !== "string")
          throw new Error("Invalid runner dependency");
        return {
          stepId: edge.from,
          status:
            run.steps.find((entry) => entry.id === edge.from)?.status ??
            "unknown",
        };
      }),
    inputs: Object.entries(bindings).map(([name, input]) => {
      const binding = readAgentObject(input);
      if (
        binding.kind !== "literal" &&
        binding.kind !== "source" &&
        binding.kind !== "result" &&
        binding.kind !== "previous"
      )
        throw new Error("Invalid runner input");
      const reference =
        binding.kind === "source" ? binding.nodeId : binding.stepId;
      return {
        name,
        kind: binding.kind,
        reference: typeof reference === "string" ? reference : null,
        digest: planContentDigest(binding),
      };
    }),
    configurationDigest: planContentDigest(pinned),
    workspaceDigest: planContentDigest(execution.workspace),
    context: {
      groupId: step.groupId ?? null,
      agentId: typeof node.agentId === "string" ? node.agentId : null,
      agentRevision:
        typeof pinned.revision === "number" ? pinned.revision : null,
      connectionId: execution.modelAccess.connectionId,
      provider: execution.modelAccess.provider,
      model: execution.modelAccess.model || null,
      workspaceIds: [execution.workspace.id],
    },
    dispatchedPromptDigest: null,
    result: {
      output: step.output,
      isOutputReduced: false,
      outputDigest: planContentDigest(step.output),
      technical: { resultCode: 0, closeout: step.remote.closeout },
      acceptance: null,
    },
    session: {
      attemptId: execution.attemptId,
      instanceId: step.remote.jobId,
      sessionId: step.remote.sessionId,
      capabilities: null,
    },
  };
}
