import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";

import { sanitizePlanOutput } from "../AgentPlanOutput";
import { planStepDirectory } from "../AgentPlanSnapshot";

import type {
  AgentPlanBinding,
  AgentPlanRun,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanCheckpointInput } from "@/definition/AgentPlanRecovery";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type {
  AgentPlanSnapshot,
  AgentPlanStepSnapshot,
} from "../AgentPlanSnapshot";

function bindingReference(binding: AgentPlanBinding): string | null {
  if (binding.kind === "source") return binding.nodeId;
  return binding.kind === "result" || binding.kind === "previous"
    ? binding.stepId
    : null;
}

function checkpointInputs(
  step: AgentPlanStepSnapshot | undefined,
): AgentPlanCheckpointInput["inputs"] {
  return Object.entries(step?.step.bindings ?? {}).map(([name, binding]) => ({
    name,
    kind: binding.kind,
    reference: bindingReference(binding),
    digest: planContentDigest(binding),
  }));
}

function configurationDigest(step: AgentPlanStepSnapshot | undefined): string {
  if (!step) return planContentDigest(null);
  return planContentDigest({
    agentId: step.step.agentId,
    revision: step.revision,
    template: step.template,
    provider: step.provider,
    model: step.model,
    reasoningEffort: step.reasoningEffort,
    connectionId: step.connectionId ?? null,
  });
}

function checkpointContext(
  step: AgentPlanStepSnapshot | undefined,
  result: AgentPlanStepResult,
  workspaceId: string,
): AgentPlanCheckpointInput["context"] {
  if (!step)
    return {
      groupId: null,
      agentId: null,
      agentRevision: null,
      connectionId: null,
      provider: null,
      model: null,
      workspaceIds: [workspaceId],
    };
  const directory = planStepDirectory(step);
  return {
    groupId: step.groupId ?? null,
    agentId: step.step.agentId,
    agentRevision: step.revision,
    connectionId:
      step.connectionId ?? result.session?.requested.connectionId ?? null,
    provider: step.provider,
    model: step.model,
    workspaceIds: [
      ...new Set([
        workspaceId,
        ...step.prepared.references.map((reference) => reference.id),
        ...(directory ? [directory.id] : []),
      ]),
    ],
  };
}

function checkpointResult(
  result: AgentPlanStepResult,
): AgentPlanCheckpointInput["result"] {
  const output = checkpointOutput(result);
  const acceptance = result.session?.acceptance;
  return {
    // The declared output already holds stdout; duplicating it can exceed the checkpoint byte budget.
    ...(result.script ? { script: { ...result.script, stdout: null } } : {}),
    ...(result.report ? { report: result.report } : {}),
    output,
    isOutputReduced: output !== result.output,
    outputDigest: planContentDigest(result.output),
    technical: {
      resultCode: result.session?.resultCode ?? null,
      closeout: result.script?.closeout ?? result.session?.closeout ?? null,
    },
    acceptance: acceptance
      ? {
          ...acceptance,
          criteria: acceptance.criteria.map((criterion) => ({
            ...criterion,
            evidence: sanitizePlanOutput(criterion.evidence),
          })),
          decisions: acceptance.decisions.map(sanitizePlanOutput),
          summary: sanitizePlanOutput(acceptance.summary),
        }
      : null,
  };
}

function checkpointOutput(result: AgentPlanStepResult): string | null {
  if (result.script || result.output === null) return result.output;
  return sanitizePlanOutput(result.output).replace(
    /data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*;base64,[a-z0-9+/=]+/giu,
    "[inline asset omitted]",
  );
}

function checkpointSession(
  session: AgentPlanSessionRecord | null | undefined,
): AgentPlanCheckpointInput["session"] {
  if (!session) return null;
  return {
    attemptId: session.attemptId ?? null,
    instanceId: session.instanceId,
    sessionId: session.sessionId,
    capabilities: session.continuationCapabilities ?? null,
  };
}

/** Captures an immutable completion; the repository allocates its revision atomically. */
export function createPlanCheckpoint(
  run: AgentPlanRun,
  snapshot: AgentPlanSnapshot,
  stepId: string,
): AgentPlanCheckpointInput {
  const result = run.steps.find((entry) => entry.id === stepId);
  if (result?.status !== "succeeded")
    throw new AgentPlanRecoveryError("checkpoint_invalid");
  const step = snapshot.steps.find((entry) => entry.step.id === stepId);
  const script = snapshot.scripts?.find((entry) => entry.step.id === stepId);
  return {
    schemaVersion: 1,
    runId: run.id,
    planId: run.planId,
    planRevision: run.planRevision,
    stepId,
    completedAt: new Date().toISOString(),
    snapshotDigest: planContentDigest(snapshot),
    workflow: { engine: "pages", runId: null },
    completedStepIds: run.steps
      .filter((entry) => entry.status === "succeeded")
      .map((entry) => entry.id),
    pendingStepIds: run.steps
      .filter((entry) => entry.status !== "succeeded")
      .map((entry) => entry.id),
    dependencies: snapshot.plan.edges
      .filter((edge) => edge.to === stepId)
      .map((edge) => ({
        stepId: edge.from,
        status:
          run.steps.find((entry) => entry.id === edge.from)?.status ??
          "unknown",
      })),
    inputs: script
      ? Object.entries(script.step.bindings).map(([name, binding]) => ({
          name,
          kind: binding.kind,
          reference: bindingReference(binding),
          digest: planContentDigest(binding),
        }))
      : checkpointInputs(step),
    configurationDigest: script
      ? planContentDigest({
          step: script.step,
          interpreter: script.interpreter,
        })
      : configurationDigest(step),
    workspaceDigest: planContentDigest(
      script?.workspace ?? checkpointWorkspace(step, snapshot.plan.workspaceId),
    ),
    context: checkpointContext(step, result, snapshot.plan.workspaceId),
    dispatchedPromptDigest: result.session?.dispatchedPromptDigest ?? null,
    result: checkpointResult(result),
    session: checkpointSession(result.session),
  };
}

function checkpointWorkspace(
  step: AgentPlanStepSnapshot | undefined,
  workspaceId: string,
): unknown {
  if (!step) return workspaceId;
  return {
    workspace: step.prepared.workspace,
    directory: planStepDirectory(step),
    references: step.prepared.references,
  };
}
