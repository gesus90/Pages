import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { ConsoleGroup } from "@/app/components/agents/plans/plan-agent-console/console-group";

import { renderConsole } from "./console-fixture";
import { runStep, syntheticRun } from "../../page72-run-fixture";

import type { AgentPlanSources, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";

const SOURCES: AgentPlanSources = { agents: [], tasks: [] };

function member(id: string, agentId: string): AgentPlanStep {
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

function group(steps: readonly AgentPlanStep[]): AgentPlanGroup {
  return {
    id: "group",
    type: "group",
    name: "Review group",
    steps,
    parameters: [],
    bindings: {},
    x: 0,
    y: 0,
  };
}

it("explains that the group has no agent steps yet", () => {
  renderConsole(
    <ConsoleGroup
      group={group([])}
      sources={SOURCES}
      run={null}
      onPick={vi.fn()}
    />,
  );
  expect(screen.getByText("This group has no agent steps yet.")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it("lists members with their run status, names a missing agent and opens the picked member", () => {
  const onPick = vi.fn();
  const run = {
    ...syntheticRun(),
    steps: [runStep("writer", { status: "failed", isBlocked: false })],
  };
  renderConsole(
    <ConsoleGroup
      group={group([member("writer", "agent-writer"), member("orphan", "")])}
      sources={SOURCES}
      run={run}
      onPick={onPick}
    />,
  );
  const buttons = screen.getAllByRole("button");
  expect(buttons).toHaveLength(2);
  expect(buttons[0]?.textContent).toContain("agent-writer");
  expect(buttons[0]?.textContent).toContain("Failed");
  expect(buttons[1]?.textContent).toBe(
    "The model mapping is missing. Choose a permitted connection and model on the node.",
  );
  fireEvent.click(
    screen.getByRole("button", { name: /model mapping is missing/ }),
  );
  expect(onPick).toHaveBeenCalledWith("orphan");
});

it("shows members without a status before the plan ran", () => {
  renderConsole(
    <ConsoleGroup
      group={group([member("writer", "agent-writer")])}
      sources={SOURCES}
      run={null}
      onPick={vi.fn()}
    />,
  );
  expect(screen.getByRole("button").textContent).toBe("agent-writer");
});
