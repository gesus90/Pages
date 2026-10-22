import { randomUUID } from "node:crypto";
import { planStepDirectory } from "./AgentPlanSnapshot";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanStepExecution } from "@/definition/AgentPlanExecution";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";

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
      workspace: {
        id: remote.target.workspaceId,
        path: remote.target.path,
        revision: remote.target.workspaceRevision,
      },
      modelAccess: {
        connectionId: null,
        connectionName: remote.target.connectionName,
        provider:
          remote.command.program.kind === "script" ? "script" : "openrouter",
        model:
          remote.command.program.kind === "model"
            ? remote.command.program.model
            : "",
        reasoningEffort: null,
      },
    });
  return {
    snapshot: {
      ...snapshot,
      execution: {
        schemaVersion: 1,
        planId: run.planId,
        runId: run.id,
        planRevision: run.planRevision,
        steps: executions,
      },
    },
    run: {
      ...run,
      steps: run.steps.map((step) => {
        const execution = executions.find((entry) => entry.stepId === step.id);
        return execution ? { ...step, execution } : step;
      }),
    },
  };
}
