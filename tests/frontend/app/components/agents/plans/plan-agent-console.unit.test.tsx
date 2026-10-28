import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanAgentConsole } from "@/app/components/agents/plans/plan-agent-console";

import {
  cliSession,
  renderConsole,
} from "./plan-agent-console/console-fixture";
import { runStep, syntheticRun } from "../page72-run-fixture";

import type { ConsoleSession } from "@/app/components/agents/plans/plan-agent-console/console-session";
import type { usePlanRun } from "@/app/components/agents/plans/use-plan-run";
import type {
  AgentPlanInput,
  AgentPlanRun,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";

vi.mock(
  "@/app/components/agents/plans/plan-agent-console/console-session",
  () => ({
    ConsoleSession: (props: Parameters<typeof ConsoleSession>[0]) => (
      <>
        {props.header("running")}
        <p data-testid="session">
          {[
            props.sessionKey.runId,
            props.sessionKey.stepId,
            props.isLive ? "live" : "settled",
            props.isReadOnly ? "read-only" : "writable",
          ].join(" ")}
        </p>
      </>
    ),
  }),
);

const SOURCES: AgentPlanSources = { agents: [], tasks: [] };

function agentNode(id: string, agentId = ""): AgentPlanStep {
  return {
    id,
    type: "agent",
    agentId,
    personalAgentId: null,
    instruction: "",
    bindings: {},
    x: 0,
    y: 0,
  };
}

function draft(): AgentPlanInput {
  return {
    name: "Synthetic plan",
    workspaceId: "workspace",
    usage: "private",
    globals: {},
    edges: [],
    nodes: [
      agentNode("writer"),
      {
        id: "group",
        type: "group",
        name: "Review group",
        steps: [agentNode("reviewer", "Reviewer")],
        parameters: [],
        bindings: {},
        x: 0,
        y: 0,
      },
    ],
  };
}

function running(
  run: AgentPlanRun | null,
  runs: readonly AgentPlanRun[] = run ? [run] : [],
): ReturnType<typeof usePlanRun> {
  return {
    run,
    runs,
    selectedId: run?.id ?? "",
    select: vi.fn(),
    error: null,
  };
}

function cliRun(overrides: Partial<AgentPlanRun> = {}): AgentPlanRun {
  return {
    ...syntheticRun(),
    steps: [
      runStep("writer", { status: "running", session: cliSession() }),
      runStep("reviewer", {
        status: "running",
        session: cliSession({ runner: "api" }),
      }),
    ],
    ...overrides,
  };
}

function renderPanel(
  nodeId: string,
  plan: ReturnType<typeof usePlanRun>,
  onClose = vi.fn(),
): ReturnType<typeof renderConsole> {
  return renderConsole(
    <PlanAgentConsole
      nodeId={nodeId}
      draft={draft()}
      sources={SOURCES}
      running={plan}
      onClose={onClose}
    />,
  );
}

function heading(): HTMLElement {
  return screen.getByRole("heading", { level: 2 });
}

it("draws nothing for a node that is neither an agent nor a group", () => {
  const { container } = renderPanel("missing", running(null));
  expect(container.textContent).toBe("");
});

it("opens an agent before any run with the focus on its heading and closes on a plain Escape", () => {
  const onClose = vi.fn();
  renderPanel("writer", running(null), onClose);
  expect(screen.getByRole("dialog").getAttribute("aria-label")).toContain(
    "Agent console",
  );
  expect(heading().textContent).toBe(
    "The model mapping is missing. Choose a permitted connection and model on the node.",
  );
  expect(document.activeElement).toBe(heading());
  expect(screen.getByText("Agent · PageAgentCLI")).toBeTruthy();
  expect(
    screen.getByText(
      "No run yet. The session appears once a run executes this node.",
    ),
  ).toBeTruthy();
  fireEvent.keyDown(document, { key: "Enter" });
  fireEvent.keyDown(document, { key: "Escape", isComposing: true });
  const handled = new KeyboardEvent("keydown", {
    key: "Escape",
    cancelable: true,
  });
  handled.preventDefault();
  document.dispatchEvent(handled);
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
});

it("opens the live session of the newest running run with its provider", () => {
  const run = cliRun();
  renderPanel("writer", running(run));
  expect(screen.getByTestId("session").textContent).toBe(
    `${run.id} writer live writable`,
  );
  expect(screen.getByRole("status").textContent).toBe(
    "Codex CLI (ChatGPT account)Turn running",
  );
});

it("reads a settled, stopping or older run as history", () => {
  const newest = cliRun({ id: "newest-run" });
  const older = cliRun({ id: "older-run" });
  const { unmount } = renderPanel("writer", running(older, [newest, older]));
  expect(screen.getByTestId("session").textContent).toBe(
    "older-run writer live read-only",
  );
  unmount();
  const stopping = renderPanel(
    "writer",
    running(cliRun({ stopRequested: true })),
  );
  expect(screen.getByTestId("session").textContent).toContain("read-only");
  stopping.unmount();
  renderPanel("writer", running(cliRun({ status: "succeeded" }), []));
  expect(screen.getByTestId("session").textContent).toBe(
    "synthetic-run writer settled read-only",
  );
  expect(screen.getByText("History · read only")).toBeTruthy();
});

it("says when the node has not started or runs over an API connection", () => {
  const run = cliRun({ steps: [] });
  const { unmount } = renderPanel("writer", running(run));
  expect(
    screen.getByText("This node has no session in the selected run yet."),
  ).toBeTruthy();
  unmount();
  renderPanel("reviewer", running(cliRun()));
  expect(
    screen.getByText(
      "This node runs over an API connection and has no CLI session.",
    ),
  ).toBeTruthy();
});

it("lets the reader pick a group member, opens its session and returns to the members", () => {
  renderPanel("group", running(cliRun()));
  expect(heading().textContent).toBe("Review group");
  expect(screen.getByText("Group · PageAgentCLI")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Back to the group members" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Reviewer/ }));
  expect(heading().textContent).toBe("Review group · Reviewer");
  expect(document.activeElement).toBe(heading());
  expect(
    screen.getByText(
      "This node runs over an API connection and has no CLI session.",
    ),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Back to the group members" }),
  );
  expect(heading().textContent).toBe("Review group");
  expect(
    screen.getByText(
      "A group shares one process between its agents, but every agent has its own session. Choose the agent step whose session you want to open.",
    ),
  ).toBeTruthy();
});

it("titles an agent by the agent it names", () => {
  const plan = draft();
  renderConsole(
    <PlanAgentConsole
      nodeId="named"
      draft={{ ...plan, nodes: [agentNode("named", "Writer")] }}
      sources={SOURCES}
      running={running(null)}
      onClose={vi.fn()}
    />,
  );
  expect(heading().textContent).toBe("Writer");
  expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe(
    "Agent console Writer",
  );
});

it("names no provider for a session record that reports no runner", () => {
  const record = cliSession();
  Reflect.deleteProperty(record, "runner");
  renderPanel(
    "writer",
    running(
      cliRun({
        steps: [runStep("writer", { status: "running", session: record })],
      }),
    ),
  );
  expect(screen.getByTestId("session").textContent).toBe(
    "synthetic-run writer live writable",
  );
  expect(screen.getByRole("status").textContent).toBe("Turn running");
});
