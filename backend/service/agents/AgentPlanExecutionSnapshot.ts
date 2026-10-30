import { randomUUID } from "node:crypto";
import { planStepDirectory } from "./AgentPlanSnapshot";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanStepExecution } from "@/definition/AgentPlanExecution";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";
import type { RemotePlanStep } from "./AgentPlanRemoteExecution";

function remoteModelAccess(
  remote: RemotePlanStep,
): AgentPlanStepExecution["modelAccess"] {
  const program = remote.command.program;
  const provider =
    remote.step.type === "agent"
      ? (remote.step.configuration?.provider ?? "openrouter")
      : "script";
  return {
    connectionId: null,
    connectionName: remote.target.connectionName,
    provider,
    model: program.kind === "script" ? "" : program.model,
    reasoningEffort: program.kind === "cli" ? program.reasoningEffort : null,
  };
}

/** Pins fresh pending remote attempts on Resume while retaining completed execution identities. */
export function continueRemotePlanExecution(
  run: AgentPlanRun,
  previous: AgentPlanSnapshot,
  snapshot: AgentPlanSnapshot,
): { readonly run: AgentPlanRun; readonly snapshot: AgentPlanSnapshot } {
  if (!snapshot.remoteSteps?.length && !previous.remoteSteps?.length)
    return { run, snapshot };
  const captured = capturePlanExecution(run, snapshot);
  const basis = captured.snapshot.execution;
  if (!basis) throw new Error("Remote continuation execution missing");
  const steps = captured.run.steps.map((step) => {
    const original = run.steps.find((entry) => entry.id === step.id);
    if (original?.status === "succeeded") return original;
    return step;
  });
  const executions = basis.steps.map(
    (execution) =>
      steps.find((step) => step.id === execution.stepId)?.execution ??
      execution,
  );
  return {
    run: { ...captured.run, steps },
    snapshot: {
      ...captured.snapshot,
      execution: { ...basis, steps: executions },
    },
  };
}

/** Detaches the immutable execution basis before persistence and allocates initial attempt IDs once. */
export function capturePlanExecution(
  run: AgentPlanRun,
  source: AgentPlanSnapshot,
): { readonly run: AgentPlanRun; readonly snapshot: AgentPlanSnapshot } {
  const snapshot = structuredClone(source);
  const executions: AgentPlanStepExecution[] = snapshot.steps.map((step) => {
    const workspace = planStepDirectory(step) ?? step.prepared.workspace;
    return {
      schemaVersion: 1,
      planId: run.planId,
      runId: run.id,
      planRevision: run.planRevision,
      stepId: step.step.id,
      attemptId: randomUUID(),
      target: step.remoteTarget ?? { kind: "local" },
      workspace: {
        id: workspace.id,
        path: workspace.path,
        revision: workspace.revision,
      },
      modelAccess: {
        connectionId: step.connectionId ?? null,
        connectionName: step.connectionName ?? "",
        provider: step.provider,
        model: step.model,
        reasoningEffort: step.reasoningEffort,
      },
    };
  });
  for (const script of snapshot.scripts ?? []) {
    executions.push({
      schemaVersion: 1,
      planId: run.planId,
      runId: run.id,
      planRevision: run.planRevision,
      stepId: script.step.id,
      attemptId: randomUUID(),
      target: { kind: "local" },
      interpreterProfileId: script.step.interpreterProfileId,
      workspace: {
        id: script.workspace.id,
        path: script.workspace.path,
        revision: script.workspace.revision,
      },
      modelAccess: {
        connectionId: null,
        connectionName: "",
        provider: "script",
        model: "",
        reasoningEffort: null,
      },
    });
  }
  for (const remote of snapshot.remoteSteps ?? [])
    executions.push({
      schemaVersion: 1,
      planId: run.planId,
      runId: run.id,
      planRevision: run.planRevision,
      stepId: remote.step.id,
      attemptId: randomUUID(),
      target: remote.target,
      ...(remote.step.type === "script"
        ? { interpreterProfileId: remote.step.interpreterProfileId }
        : {}),
      workspace: {
        id: remote.target.workspaceId,
        path: remote.target.path,
        revision: remote.target.workspaceRevision,
      },
      modelAccess: remoteModelAccess(remote),
      ...(remote.parameters
        ? { resources: [...remote.parameters.resources] }
        : {}),
    });
  const preserved = retainedExecutions(run, executions);
  return {
    snapshot: {
      ...snapshot,
      execution: {
        schemaVersion: 1,
        planId: run.planId,
        runId: run.id,
        planRevision: run.planRevision,
        steps: preserved,
      },
    },
    run: {
      ...run,
      steps: run.steps.map((step) => {
        const execution = preserved.find((entry) => entry.stepId === step.id);
        return execution ? { ...step, execution } : step;
      }),
    },
  };
}

function retainedExecutions(
  run: AgentPlanRun,
  executions: readonly AgentPlanStepExecution[],
): readonly AgentPlanStepExecution[] {
  return executions.map((execution) => {
    const completed = run.steps.find(
      (step) => step.id === execution.stepId && step.status === "succeeded",
    );
    return completed?.execution ?? execution;
  });
}
