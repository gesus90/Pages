import { fireEvent, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanGroupEditor } from "@/app/components/agents/plans/plan-group-editor";

import {
  GROUP_SOURCES,
  agentNode,
  graphStub,
  i18n,
  planOf,
  renderTranslated,
  sessionGroup,
} from "./plan-group-fixture";

import type { PlanGraphActions } from "@/app/components/agents/plans/use-plan-graph";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";

const TEAM = sessionGroup({
  name: "Team",
  x: 100,
  y: 50,
  steps: [
    agentNode("m1", "codex"),
    agentNode("m2", "removed-agent", { x: 320 }),
  ],
});

function renderEditor(
  group: AgentPlanGroup,
  graph: PlanGraphActions,
  disabled = false,
): void {
  renderTranslated(
    <PlanGroupEditor
      group={group}
      draft={planOf([group])}
      sources={GROUP_SOURCES}
      graph={graph}
      disabled={disabled}
    />,
  );
}

async function offeredAgents(): Promise<readonly string[]> {
  fireEvent.keyDown(
    screen.getByRole("combobox", { name: i18n.t("plans.groups.addAgent") }),
    { key: "Enter" },
  );
  const options = await screen.findAllByRole("option");
  return options.map((option) => option.textContent ?? "");
}

function memberRows(): readonly HTMLElement[] {
  return within(
    screen.getByRole("list", { name: i18n.t("plans.groups.order") }),
  ).getAllByRole("listitem");
}

it("renames the group and names its class and members in stored order", () => {
  const graph = graphStub();
  renderEditor(TEAM, graph);
  fireEvent.change(
    screen.getByRole("textbox", { name: i18n.t("plans.groups.panel.name") }),
    { target: { value: "Renamed" } },
  );
  expect(graph.replaceNode).toHaveBeenCalledWith({ ...TEAM, name: "Renamed" });
  expect(
    screen.getByText(i18n.t("plans.groups.adapter.codex_cli")),
  ).toBeTruthy();
  expect(
    memberRows().map((item) => item.querySelector("span")?.textContent),
  ).toEqual(["Codex One", i18n.t("plans.missingAgent")]);
  expect(screen.getByText(i18n.t("plans.groups.orderOpen"))).toBeTruthy();
  expect(screen.getByText(i18n.t("plans.groups.panel.note"))).toBeTruthy();
});

it("selects, takes out and deletes a member from its row", async () => {
  const graph = graphStub();
  renderEditor(TEAM, graph);
  const [first] = memberRows();
  if (!first) throw new Error("Missing member");
  fireEvent.click(
    within(first).getByRole("button", {
      name: i18n.t("plans.groups.selectMember"),
    }),
  );
  expect(graph.select).toHaveBeenCalledWith("m1");
  fireEvent.click(
    within(first).getByRole("button", { name: i18n.t("plans.groups.takeOut") }),
  );
  expect(graph.assign).toHaveBeenCalledWith("m1", null);
  fireEvent.keyDown(
    within(first).getByRole("button", {
      name: i18n.t("settings.agents.actionsFor", { name: "Codex One" }),
    }),
    { key: "Enter" },
  );
  fireEvent.click(
    await screen.findByRole("menuitem", { name: i18n.t("plans.delete") }),
  );
  expect(graph.remove).toHaveBeenCalledWith("m1");
});

it("offers only usable agents of the group's class and adds one right of the members", async () => {
  const graph = graphStub();
  renderEditor(TEAM, graph);
  const add = screen.getByRole("button", {
    name: i18n.t("plans.groups.addAgent"),
  });
  expect(add).toHaveProperty("disabled", true);
  expect(await offeredAgents()).toEqual([
    i18n.t("plans.groups.panel.addPlaceholder"),
    "Codex One · Codex CLI · codex-model",
    "Codex Two · Codex CLI · codex-two-model",
  ]);
  fireEvent.click(
    screen.getByRole("option", {
      name: "Codex Two · Codex CLI · codex-two-model",
    }),
  );
  fireEvent.click(add);
  // The member area starts 20 px right of and 108 px below the frame's corner.
  expect(graph.add).toHaveBeenCalledWith(
    "agent",
    "codex-two",
    { x: 120 + 640, y: 158 },
    "group",
  );
  expect(add).toHaveProperty("disabled", true);
});

it("lets an empty group take any usable ACP agent and tells why an insertion failed", async () => {
  const graph = graphStub({ insertionError: "name_taken" });
  renderEditor(sessionGroup(), graph);
  expect(screen.getByText(i18n.t("plans.groups.adapter.neutral"))).toBeTruthy();
  expect(screen.getByText(i18n.t("plans.groups.empty"))).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toBe(
    i18n.t("settings.agents.error.name_taken"),
  );
  expect(await offeredAgents()).toEqual([
    i18n.t("plans.groups.panel.addPlaceholder"),
    "Codex One · Codex CLI · codex-model",
    "Codex Two · Codex CLI · codex-two-model",
    "Claude · Claude Code · claude-model",
  ]);
  fireEvent.click(
    screen.getByRole("option", { name: "Claude · Claude Code · claude-model" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.groups.addAgent") }),
  );
  expect(graph.add).toHaveBeenCalledWith(
    "agent",
    "claude",
    { x: 20, y: 108 },
    "group",
  );
});

it("locks every field while editing is disabled", () => {
  renderEditor(TEAM, graphStub(), true);
  expect(
    screen
      .getByRole("textbox", { name: i18n.t("plans.groups.panel.name") })
      .matches(":disabled"),
  ).toBe(true);
  expect(
    screen
      .getByRole("button", { name: i18n.t("plans.groups.addAgent") })
      .matches(":disabled"),
  ).toBe(true);
});
