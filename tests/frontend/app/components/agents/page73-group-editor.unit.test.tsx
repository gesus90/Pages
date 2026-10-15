import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { acpRunOptions } from "@/definition/AgentConfiguration";

import {
  SOURCES,
  i18n,
  planServer,
  renderPlanPage,
} from "./page61-plan-fixture";

import type { PlanServer } from "./page61-plan-fixture";

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterAll(() => {
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

function groupServer(): PlanServer {
  const server = planServer();
  if (!server.plan) throw new Error("Missing plan");
  server.plan = {
    ...server.plan,
    nodes: server.plan.nodes.filter((node) =>
      ["start", "end", "spare"].includes(node.id),
    ),
    edges: [],
  };
  server.sources = {
    ...SOURCES,
    agents: SOURCES.agents.map((source, index) => ({
      ...source,
      id: `agent-${index}`,
      name: `Test ${index + 1}`,
      provider: "codex_cli",
      configuration: {
        ...source.configuration,
        markdown: "{{shared}}",
        run: acpRunOptions("read_only", 0),
        parameters: [
          {
            name: "shared",
            type: "text",
            description: "",
            isRequired: true,
            defaultValue: null,
          },
        ],
      },
    })),
  };
  return server;
}

async function choose(
  name: string,
  option: string,
  scope: HTMLElement = document.body,
): Promise<void> {
  fireEvent.keyDown(within(scope).getByRole("combobox", { name }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

async function createGroup(): Promise<void> {
  await screen.findByRole("tab", { name: "Gruppen" });
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Gruppen" }));
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.groups.create") }),
  );
  for (const index of [1, 2]) {
    await choose(
      i18n.t("plans.groups.addAgent"),
      `Test ${index} · synthetic-free:free`,
    );
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("plans.groups.addAgent") }),
    );
  }
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.groups.addPort") }),
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: i18n.t("plans.groups.portName") }),
    { target: { value: "shared" } },
  );
}

async function bindInternalPorts(): Promise<void> {
  const list = screen.getByRole("list", { name: i18n.t("plans.groups.order") });
  for (const row of within(list).getAllByRole("listitem")) {
    fireEvent.click(within(row).getByText(i18n.t("plans.editNode")));
    await choose(
      i18n.t("plans.bindingSource", { name: "shared" }),
      "shared (text) → shared",
      row,
    );
  }
}

function connectOuterGraph(): void {
  const grid = screen.getByRole("region", { name: i18n.t("plans.grid") });
  const start = within(grid).getByRole("article", { name: "Start" });
  const group = within(grid).getByRole("article", {
    name: i18n.t("plans.groups.defaultName"),
  });
  const end = within(grid).getByRole("article", { name: "Ende" });
  const value = within(grid).getByRole("article", { name: "spare" });
  fireEvent.click(
    within(start).getByRole("button", { name: i18n.t("plans.flowOut") }),
  );
  fireEvent.click(
    within(group).getByRole("button", { name: i18n.t("plans.flowIn") }),
  );
  fireEvent.click(
    within(group).getByRole("button", { name: i18n.t("plans.flowOut") }),
  );
  fireEvent.click(
    within(end).getByRole("button", { name: i18n.t("plans.flowIn") }),
  );
  fireEvent.click(
    within(value).getByRole("button", { name: i18n.t("plans.valueOut") }),
  );
  fireEvent.click(
    within(group).getByRole("button", {
      name: i18n.t("plans.bindPort", {
        parameter: "shared",
        name: i18n.t("plans.groups.defaultName"),
      }),
    }),
  );
}

it("shows Agents / Gruppen / Tickets / Parameter and saves an editable ordered subgraph with a visible shared port", async () => {
  const server = groupServer();
  const rendered = renderPlanPage(server);
  await screen.findByRole("tab", { name: "Gruppen" });
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
    "Agents",
    "Gruppen",
    "Tickets",
    "Parameter",
  ]);
  await createGroup();
  await bindInternalPorts();
  fireEvent.click(
    screen.getAllByRole("button", { name: i18n.t("plans.groups.up") })[1] ??
      document.body,
  );
  connectOuterGraph();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("plans.save") }));
  await waitFor(() => expect(server.saved).toHaveLength(1));
  const group = server.saved[0]?.nodes.find((node) => node.type === "group");
  if (group?.type !== "group") throw new Error("Missing saved group");
  expect(group.steps.map((step) => step.agentId)).toEqual([
    "agent-1",
    "agent-0",
  ]);
  expect(group.bindings.shared).toEqual({ kind: "source", nodeId: "spare" });
  expect(group.steps.map((step) => step.bindings.shared)).toEqual([
    { kind: "source", nodeId: group.parameters[0]?.id },
    { kind: "source", nodeId: group.parameters[0]?.id },
  ]);
  expect(server.saved[0]?.edges).toHaveLength(2);
  rendered.unmount();
  renderPlanPage(server);
  await screen.findByRole("tab", { name: "Gruppen" });
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.selectNode", { name: group.name }),
    }),
  );
  expect(
    screen.getByRole("list", { name: i18n.t("plans.groups.order") }),
  ).toBeDefined();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.groups.removePort") }),
  );
  expect(
    screen.getAllByText(i18n.t("plans.validation.source"), { exact: false })
      .length,
  ).toBeGreaterThan(0);
  expect(
    screen.getByRole("button", { name: i18n.t("plans.play") }),
  ).toHaveProperty("disabled", true);
}, 20_000);
