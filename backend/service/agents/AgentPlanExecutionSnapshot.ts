import { randomUUID } from "node:crypto";
import { planStepDirectory } from "./AgentPlanSnapshot";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanStepExecution } from "@/definition/AgentPlanExecution";
import type {
  AgentPlanSnapshot,
  AgentPlanStepSnapshot,
} from "./AgentPlanSnapshot";
import type { AgentPlanScriptSnapshot } from "./AgentPlanScriptPreparation";
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
    connectionId: remote.localSource?.agent?.connectionId ?? null,
    connectionName:
      remote.localSource?.agent?.connectionName ?? remote.target.connectionName,
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
    if (original?.status === "succeeded" || original?.status === "running")
      return original;
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
  const runnerIds = new Set(
    snapshot.remoteSteps?.map((entry) => entry.step.id),
  );
  const executions: AgentPlanStepExecution[] = snapshot.steps
    .filter((step) => !runnerIds.has(step.step.id))
    .map((step) => stepExecution(run, step));
  for (const script of snapshot.scripts ?? []) {
    if (runnerIds.has(script.step.id)) continue;
    executions.push(scriptExecution(run, script));
  }
  for (const remote of snapshot.remoteSteps ?? [])
    executions.push(remoteExecutionEntry(run, remote));
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

function stepExecution(
  run: AgentPlanRun,
  step: AgentPlanStepSnapshot,
): AgentPlanStepExecution {
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
}

function scriptExecution(
  run: AgentPlanRun,
  script: AgentPlanScriptSnapshot,
): AgentPlanStepExecution {
  return {
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
  };
}

function remoteExecutionEntry(
  run: AgentPlanRun,
  remote: RemotePlanStep,
): AgentPlanStepExecution {
  return {
    schemaVersion: 1,
    planId: run.planId,
    runId: run.id,
    planRevision: run.planRevision,
    stepId: remote.step.id,
    attemptId: randomUUID(),
    target: remote.target,
    ...(remote.step.type === "script"
      ? {
          interpreterProfileId:
            remote.localSource?.script?.step.interpreterProfileId ??
            remote.step.interpreterProfileId,
        }
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
