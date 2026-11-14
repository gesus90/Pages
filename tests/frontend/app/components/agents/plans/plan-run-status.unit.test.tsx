import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { PlanRunStatus } from "@/app/components/agents/plans/plan-run-status";
import { createI18n } from "@/app/lib/i18n";
import { focusStatusNode } from "@/app/components/agents/plans/plan-status-focus";

import { syntheticRun } from "../page72-run-fixture";
import {
  agentNode,
  flowEdge,
  GROUP_SOURCES,
  graphStub,
  planOf,
} from "./plan-group-fixture";
import { runStep } from "./plan-panel-fixture";

import type { PlanCanvasProps } from "@/app/components/agents/plans/plan-flow-context";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

const i18n = createI18n("en");
const flow = vi.hoisted(() => ({ getNode: vi.fn() }));

vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useReactFlow: () => flow,
}));
vi.mock("@/app/components/agents/plans/plan-status-focus", () => ({
  focusStatusNode: vi.fn(),
}));

const PLAN = planOf(
  [
    { id: "start", type: "start", x: 0, y: 0 },
    agentNode("alpha", "codex"),
    agentNode("beta", "codex"),
    agentNode("gamma", "codex"),
    { id: "end", type: "end", x: 900, y: 0 },
  ],
  [
    flowEdge("start", "alpha"),
    flowEdge("alpha", "beta"),
    flowEdge("beta", "gamma"),
    flowEdge("gamma", "end"),
  ],
);

function runOf(
  steps: readonly AgentPlanStepResult[],
  overrides: Partial<AgentPlanRun> = {},
): AgentPlanRun {
  return { ...syntheticRun(), steps, ...overrides };
}

function canvasOf(overrides: Partial<PlanCanvasProps> = {}): PlanCanvasProps {
  return {
    draft: PLAN,
    sources: GROUP_SOURCES,
    graph: graphStub(),
    canEdit: true,
    run: null,
    ...overrides,
  };
}

function renderStatus(
  canvas: PlanCanvasProps,
  onToggle = vi.fn(),
  isOpen = true,
): void {
  render(
    <I18nextProvider i18n={i18n}>
      <PlanRunStatus canvas={canvas} isOpen={isOpen} onToggle={onToggle} />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  flow.getNode.mockReset();
  vi.mocked(focusStatusNode).mockReset();
});

it("keeps the details closed and reports the toggle", () => {
  const onToggle = vi.fn();
  renderStatus(canvasOf(), onToggle, false);

  expect(screen.getByRole("region", { name: "Run progress" })).toBeTruthy();
  expect(screen.queryByText(/Step 1/u)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Open run details/u }));
  expect(onToggle).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  "keeps a failed start visible with run details open=%s after a later command",
  (isOpen) => {
    const run = runOf([runStep("alpha", { status: "cancelled" })], {
      status: "failed",
      startError: "profile_invalid",
      command: {
        id: "later-stop",
        runId: "run-1",
        action: "stop",
        status: "applied",
        acceptedAt: "2026-11-13T10:00:00.000Z",
      },
    });
    renderStatus(canvasOf({ run }), vi.fn(), isOpen);

    expect(screen.getByRole("alert").textContent).toBe(
      i18n.t("plans.startFailed", {
        reason: i18n.t("settings.agents.error.profile_invalid"),
      }),
    );
  },
);

it("names the missing selection while no run is shown", () => {
  renderStatus(canvasOf());

  expect(screen.getByText(i18n.t("plans.progress.noSelection"))).toBeTruthy();
});

it("names the node that blocked a waiting step, by its recorded name or else its id", () => {
  const run = runOf([
    runStep("start", { status: "succeeded" }),
    runStep("alpha", { name: "Alpha agent", status: "failed" }),
    runStep("beta", {
      isBlocked: true,
      blockedByStepId: "alpha",
    }),
    runStep("gamma", { isBlocked: true, blockedByStepId: "unrecorded" }),
  ]);
  renderStatus(canvasOf({ run }));

  fireEvent.click(screen.getByRole("button", { name: /^2 · /u }));
  expect(
    screen.getByText(
      i18n.t("plans.progress.blockedBy", { name: "Alpha agent" }),
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^3 · /u }));
  expect(
    screen.getByText(
      i18n.t("plans.progress.blockedBy", { name: "unrecorded" }),
    ),
  ).toBeTruthy();
});

it("describes a step without a record as an outlook", () => {
  const run = runOf([
    runStep("start", { status: "succeeded" }),
    runStep("alpha", { status: "running" }),
  ]);
  renderStatus(canvasOf({ run }));

  fireEvent.click(screen.getByRole("button", { name: /^2 · /u }));
  expect(
    screen.getByText(i18n.t("plans.progress.outlook.planned")),
  ).toBeTruthy();
});

it("selects the node of the shown block and has the canvas fit it", () => {
  const node = { id: "alpha" };
  flow.getNode.mockImplementation((id: string) =>
    id === "alpha" ? node : undefined,
  );
  const graph = graphStub();
  const run = runOf([
    runStep("start", { status: "succeeded" }),
    runStep("alpha", { status: "running" }),
  ]);
  renderStatus(canvasOf({ run, graph }));

  fireEvent.click(screen.getByRole("button", { name: /^1 · /u }));
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.progress.locate") }),
  );

  expect(graph.select).toHaveBeenCalledWith("alpha");
  expect(focusStatusNode).toHaveBeenCalledWith(
    flow,
    "alpha",
    document.querySelector("[data-plan-run-status]"),
  );
});

it("disables locating a step whose node is no longer in the plan", () => {
  flow.getNode.mockReturnValue(undefined);
  const graph = graphStub();
  const run = runOf([runStep("alpha", { status: "running" })]);
  renderStatus(canvasOf({ run, graph }));
  fireEvent.click(screen.getByRole("button", { name: /^1 · /u }));

  const button = screen.getByRole("button", {
    name: i18n.t("plans.progress.nodeMissing"),
  });
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.click(button);
  expect(graph.select).not.toHaveBeenCalled();
  expect(focusStatusNode).not.toHaveBeenCalled();
});

it("reads the sequence from the plan revision the run executed, not from the draft", () => {
  const executed = planOf(
    [
      { id: "start", type: "start", x: 0, y: 0 },
      agentNode("alpha", "codex"),
      { id: "end", type: "end", x: 900, y: 0 },
    ],
    [flowEdge("start", "alpha"), flowEdge("alpha", "end")],
  );
  const run = runOf([
    runStep("start", { status: "succeeded" }),
    runStep("alpha", { status: "succeeded" }),
  ]);
  renderStatus(canvasOf({ run, runPlan: executed }));

  expect(screen.queryByRole("button", { name: /^2 · /u })).toBeNull();
  expect(screen.getByRole("button", { name: /^1 · /u })).toBeTruthy();
});
