import { fireEvent, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanGroupLegacy } from "@/app/components/agents/plans/plan-group-legacy";

import {
  GROUP_SOURCES,
  agentNode,
  flowEdge,
  graphStub,
  i18n,
  planOf,
  renderTranslated,
  sessionGroup,
} from "./plan-group-fixture";

import type { PlanGraphActions } from "@/app/components/agents/plans/use-plan-graph";
import type { AgentPlanEdge } from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";

const MEMBERS = [agentNode("m1", "codex"), agentNode("m2", "claude")];

function renderLegacy(
  group: AgentPlanGroup,
  edges: readonly AgentPlanEdge[],
  options: {
    readonly graph?: PlanGraphActions;
    readonly disabled?: boolean;
  } = {},
): ReturnType<typeof renderTranslated> {
  return renderTranslated(
    <PlanGroupLegacy
      group={group}
      draft={planOf(
        [
          { id: "start", type: "start", x: 0, y: 0 },
          group,
          { id: "end", type: "end", x: 0, y: 0 },
        ],
        edges,
      )}
      graph={options.graph ?? graphStub()}
      sources={GROUP_SOURCES}
      disabled={options.disabled ?? false}
    />,
  );
}

it("shows nothing for a group without legacy edges, ports or bindings", () => {
  const { container } = renderLegacy(sessionGroup({ steps: MEMBERS }), [
    flowEdge("start", "end"),
  ]);
  expect(container.childElementCount).toBe(0);
});

it("lets each frame edge be resolved to a member or removed", async () => {
  const graph = graphStub();
  renderLegacy(
    sessionGroup({ steps: MEMBERS }),
    [
      flowEdge("start", "end"),
      flowEdge("start", "group"),
      flowEdge("group", "end"),
    ],
    { graph },
  );
  expect(screen.getByRole("alert").textContent).toBe(
    i18n.t("plans.validation.groupBoundary"),
  );
  expect(screen.getByText("start → group")).toBeTruthy();
  expect(screen.getByText("group → end")).toBeTruthy();
  const [, outgoing] = screen.getAllByRole("combobox", {
    name: i18n.t("plans.groups.chooseEndpoint"),
  });
  if (!outgoing) throw new Error("Missing endpoint choice");
  fireEvent.keyDown(outgoing, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: "Claude" }));
  // The index counts in the plan's edges, the unrelated first edge included.
  expect(graph.resolveGroupEdge).toHaveBeenCalledWith("group", 2, "m2");
  const [removeIncoming] = screen.getAllByRole("button", {
    name: i18n.t("plans.groups.removeLegacyEdge"),
  });
  if (!removeIncoming) throw new Error("Missing edge removal");
  fireEvent.click(removeIncoming);
  expect(graph.disconnect).toHaveBeenCalledWith({
    kind: "flow",
    from: "start",
    to: "group",
  });
  // Without retained ports or bindings there is nothing else to show.
  expect(screen.queryByText(i18n.t("plans.groups.legacy"))).toBeNull();
});

it("locks the edge repair while editing is disabled", () => {
  renderLegacy(sessionGroup({ steps: MEMBERS }), [flowEdge("start", "group")], {
    disabled: true,
  });
  expect(
    screen.getByRole("combobox", {
      name: i18n.t("plans.groups.chooseEndpoint"),
    }),
  ).toHaveProperty("disabled", true);
  expect(
    screen.getByRole("button", {
      name: i18n.t("plans.groups.removeLegacyEdge"),
    }),
  ).toHaveProperty("disabled", true);
});

it("keeps retained ports and bindings readable without offering to edit them", () => {
  const parameters = [
    {
      id: "port",
      name: "common",
      type: "text" as const,
      description: "",
      isRequired: true,
      defaultValue: null,
    },
  ];
  const { unmount } = renderLegacy(sessionGroup({ parameters }), []);
  expect(screen.getByText(i18n.t("plans.groups.legacy"))).toBeTruthy();
  expect(screen.getByText(i18n.t("plans.groups.legacyHint"))).toBeTruthy();
  expect(JSON.parse(document.querySelector("pre")?.textContent ?? "")).toEqual({
    parameters,
    bindings: {},
  });
  expect(screen.queryByRole("alert")).toBeNull();
  unmount();
  const bindings = { common: { kind: "source" as const, nodeId: "start" } };
  renderLegacy(sessionGroup({ bindings }), []);
  expect(JSON.parse(document.querySelector("pre")?.textContent ?? "")).toEqual({
    parameters: [],
    bindings,
  });
});
