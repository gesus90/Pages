import { screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanStatusDetails } from "@/app/components/agents/plans/plan-status-details";

import { runStep } from "../page72-run-fixture";
import { renderTranslated } from "./plan-panel-fixture";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";

function remoteScript(): AgentPlanStepResult {
  return runStep("review", {
    name: "Remote review",
    status: "failed",
    error: "plan_script_exit",
    execution: {
      schemaVersion: 1,
      planId: "plan",
      runId: "run",
      stepId: "review",
      attemptId: "00000000-0000-4000-8000-000000000001",
      planRevision: 3,
      interpreterProfileId: "synthetic-python",
      target: {
        kind: "remote",
        connectionId: "connection",
        connectionRevision: 1,
        connectionName: "Synthetic host",
        workspaceId: "workspace",
        workspaceRevision: 1,
        workspaceName: "Synthetic copy",
        path: "/synthetic/repository",
      },
      workspace: {
        id: "workspace",
        path: "/synthetic/repository",
        revision: 1,
      },
      modelAccess: {
        connectionId: null,
        connectionName: "Synthetic host",
        provider: "script",
        model: "",
        reasoningEffort: null,
      },
    },
    remote: {
      jobId: "00000000-0000-4000-8000-000000000002",
      sessionId: "00000000-0000-4000-8000-000000000003",
      status: "failed",
      startedAt: "2026-10-28T00:00:00.000Z",
      endedAt: "2026-10-28T00:00:01.000Z",
      closeout: "confirmed",
      exitCode: 7,
      signal: null,
      reason: "exit",
      stdout: "synthetic stdout",
      stderr: "synthetic warning",
    },
  });
}

function renderStep(step: AgentPlanStepResult): void {
  renderTranslated(
    <PlanStatusDetails
      step={step}
      number={1}
      end={null}
      canLocate={false}
      onLocate={vi.fn()}
    />,
  );
}

it("shows the remote script's source failure, interpreter, exit and separate streams", () => {
  renderStep(remoteScript());
  const section = screen.getByText("Script process").closest("section");
  if (!section) throw new Error("Script section is missing");
  expect(within(section).getByText("synthetic-python")).toBeDefined();
  expect(within(section).getByText("7")).toBeDefined();
  expect(within(section).getByLabelText("stdout").textContent).toBe(
    "synthetic stdout",
  );
  expect(within(section).getByLabelText("stderr").textContent).toBe(
    "synthetic warning",
  );
  expect(within(section).getByRole("alert").textContent).toContain(
    "exited with an error",
  );
  expect(within(section).getByText(/bounded stderr tail/u)).toBeDefined();
  expect(screen.queryByText("No configuration recorded.")).toBeNull();
});

it("uses a historical script result when separate stdout was not retained", () => {
  const step = remoteScript();
  if (!step.remote) throw new Error("Remote progress is missing");
  renderStep({
    ...step,
    output: "historical result",
    remote: { ...step.remote, stdout: undefined, stderr: "" },
  });
  expect(screen.getByLabelText("stdout").textContent).toBe("historical result");
  expect(screen.getByLabelText("stderr").textContent).toBe("(empty)");
});

it("distinguishes a missing stream from an empty stream", () => {
  const step = remoteScript();
  if (!step.remote) throw new Error("Remote progress is missing");
  renderStep({
    ...step,
    remote: { ...step.remote, stdout: undefined, stderr: "" },
  });
  expect(screen.getByLabelText("stdout").textContent).toBe("(not recorded)");
  expect(screen.getByLabelText("stderr").textContent).toBe("(empty)");
});

it("marks interrupted remote output as potentially incomplete", () => {
  const step = remoteScript();
  if (!step.remote) throw new Error("Remote progress is missing");
  renderStep({
    ...step,
    error: "plan_script_timeout",
    remote: { ...step.remote, reason: "timeout" },
  });
  expect(screen.getByText(/captured output may be incomplete/u)).toBeDefined();
});

it("does not present an agent result as script stdout", () => {
  const step = remoteScript();
  if (!step.execution) throw new Error("Execution is missing");
  renderStep({
    ...step,
    execution: {
      ...step.execution,
      modelAccess: { ...step.execution.modelAccess, provider: "codex_cli" },
    },
  });
  expect(screen.queryByLabelText("stdout")).toBeNull();
});
