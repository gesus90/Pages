import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanExecutionDetails } from "@/app/components/agents/plans/plan-execution-details";

import { runStep, syntheticSession } from "../page72-run-fixture";
import { i18n, renderTranslated } from "./plan-flow-fixture";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanStepExecution } from "@/definition/AgentPlanExecution";

const ATTEMPT = "00000000-0000-4000-8000-000000000001";

function execution(
  overrides: Partial<AgentPlanStepExecution> = {},
): AgentPlanStepExecution {
  return {
    schemaVersion: 1,
    planId: "plan-1",
    runId: "run-1",
    stepId: "writer",
    attemptId: ATTEMPT,
    planRevision: 7,
    target: { kind: "local" },
    workspace: { id: "workspace-1", path: "/srv/pages", revision: 3 },
    modelAccess: {
      connectionId: "connection-1",
      connectionName: "OpenRouter main",
      provider: "openrouter",
      model: "claude-sonnet",
      reasoningEffort: "high",
    },
    ...overrides,
  };
}

const REMOTE = {
  kind: "remote",
  connectionId: "nas",
  connectionRevision: 2,
  connectionName: "homeNAS",
  workspaceId: "pages",
  workspaceRevision: 4,
  workspaceName: "pageNAS",
  path: "/volume1/pages",
} as const;

const SCRIPT_ACCESS = {
  connectionId: null,
  connectionName: "",
  provider: "script",
  model: "",
  reasoningEffort: null,
} as const;

/** The name and content of every row of the snapshot and of the identifiers. */
function renderRows(step: AgentPlanStepResult): {
  readonly snapshot: string[][];
  readonly identifiers: string[][];
} {
  const { container } = renderTranslated(<PlanExecutionDetails step={step} />);
  const [snapshot, identifiers] = [...container.querySelectorAll("dl")].map(
    (list) =>
      [...list.querySelectorAll(":scope > div")].map((entry) =>
        [...entry.children].map((cell) => cell.textContent ?? ""),
      ),
  );
  return { snapshot: snapshot ?? [], identifiers: identifiers ?? [] };
}

function row(name: string, content: string): string[] {
  return [i18n.t(`plans.execution.${name}`), content];
}

function notApplicable(): string {
  return i18n.t("plans.progress.notApplicable");
}

it("shows nothing for a step that never started", () => {
  const { container } = renderTranslated(
    <PlanExecutionDetails step={runStep("writer")} />,
  );

  expect(container.childElementCount).toBe(0);
});

it("shows the frozen local context of an agent node", () => {
  const { snapshot, identifiers } = renderRows(
    runStep("writer", { execution: execution() }),
  );

  expect(snapshot).toEqual([
    row("revision", "7"),
    row("target", i18n.t("plans.execution.local")),
    row("workspace", "/srv/pages"),
    row("modelAccess", "OpenRouter main · openrouter"),
    row("model", "claude-sonnet"),
    row(
      "reasoning",
      i18n.t("plans.execution.frozenReasoning", { reasoning: "high" }),
    ),
  ]);
  expect(identifiers).toEqual([
    row("planId", "plan-1"),
    row("runId", "run-1"),
    row("stepId", "writer"),
    row("attemptId", ATTEMPT),
    row("workspace", "workspace-1 · r3"),
    row("modelAccess", "connection-1"),
  ]);
  expect(
    screen.getByRole("heading", { name: i18n.t("plans.execution.snapshot") }),
  ).toBeDefined();
});

it("names the default reasoning and the session's own attempt", () => {
  const { snapshot, identifiers } = renderRows(
    runStep("writer", {
      execution: execution({
        modelAccess: {
          connectionId: null,
          connectionName: "Claude Code",
          provider: "claude_code",
          model: "claude-opus",
          reasoningEffort: null,
        },
      }),
      session: { ...syntheticSession(), attemptId: "session-attempt" },
    }),
  );

  expect(snapshot).toContainEqual(
    row(
      "reasoning",
      i18n.t("plans.execution.frozenReasoning", {
        reasoning: i18n.t("pageAgents.defaultReasoning"),
      }),
    ),
  );
  expect(identifiers).toContainEqual(row("attemptId", "session-attempt"));
  expect(identifiers).toContainEqual(row("modelAccess", notApplicable()));
});

it("keeps the run's attempt for a session recorded before attempts existed", () => {
  const { identifiers } = renderRows(
    runStep("writer", { execution: execution(), session: syntheticSession() }),
  );

  expect(identifiers).toContainEqual(row("attemptId", ATTEMPT));
});

it("shows the remote target and the process attempt of a script without model rows", () => {
  const { snapshot, identifiers } = renderRows(
    runStep("script", {
      execution: execution({ target: REMOTE, modelAccess: SCRIPT_ACCESS }),
      script: {
        attemptId: "script-attempt",
        instanceId: "instance",
        interpreterProfileId: "bash",
        directory: "/volume1/pages",
        userId: "owner",
        uid: 1000,
        gid: 1000,
        processId: null,
        startedAt: "2026-10-15T10:00:00.000Z",
        endedAt: null,
        exitCode: null,
        signal: null,
        failure: null,
        closeout: "pending",
        stdout: null,
        stderr: "",
      },
    }),
  );

  expect(snapshot).toEqual([
    row("revision", "7"),
    row("target", "homeNAS"),
    row("workspace", "pageNAS · /volume1/pages"),
    row("modelAccess", notApplicable()),
    row("model", notApplicable()),
    row("reasoning", notApplicable()),
  ]);
  expect(identifiers).toEqual([
    row("planId", "plan-1"),
    row("runId", "run-1"),
    row("stepId", "script"),
    row("attemptId", "script-attempt"),
    row("workspace", "pages · r4"),
    row("modelAccess", notApplicable()),
    row("target", "nas · r2"),
  ]);
});
