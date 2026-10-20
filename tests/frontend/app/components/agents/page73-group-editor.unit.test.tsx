import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { acpRunOptions } from "@/definition/AgentConfiguration";

import {
  SOURCES,
  i18n,
  planServer,
  pressSave,
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
    nodes: [
      ...server.plan.nodes.filter((node) =>
        ["start", "end", "spare"].includes(node.id),
      ),
      {
        id: "group",
        type: "group",
        name: i18n.t("plans.groups.defaultName"),
        x: 320,
        y: 0,
        steps: [],
        parameters: [],
        bindings: {},
      },
    ],
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

const GROUP = i18n.t("plans.groups.defaultName");

function canvas(): HTMLElement {
  return screen.getByRole("region", { name: i18n.t("plans.canvas") });
}

function card(name: string): HTMLElement {
  return within(canvas()).getByRole("article", { name });
}

function frame(): HTMLElement {
  return within(canvas()).getByRole("region", {
    name: i18n.t("plans.groups.frame", { name: GROUP }),
  });
}

/** The group's settings open from its edit button, as every node dialog does. */
async function openGroupDialog(): Promise<HTMLElement> {
  fireEvent.click(
    within(frame()).getByRole("button", {
      name: i18n.t("plans.editNamed", { name: GROUP }),
    }),
  );
  return screen.findByRole("dialog", {
    name: i18n.t("plans.groups.panel.label", { name: GROUP }),
  });
}

function closeDialog(dialog: HTMLElement): void {
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: i18n.t("plans.groups.panel.closeButton"),
    }),
  );
}

async function addMembers(dialog: HTMLElement): Promise<void> {
  for (const name of ["Test 2", "Test 1"]) {
    fireEvent.keyDown(
      within(dialog).getByRole("combobox", {
        name: i18n.t("plans.groups.addAgent"),
      }),
      { key: "Enter" },
    );
    fireEvent.click(
      await screen.findByRole("option", { name: new RegExp(`^${name} ·`) }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: i18n.t("plans.groups.addAgent"),
      }),
    );
    await within(
      within(dialog).getByRole("list", { name: i18n.t("plans.groups.order") }),
    ).findByText(new RegExp(name));
  }
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: i18n.t("plans.groups.addPort"),
    }),
  );
  fireEvent.change(
    within(dialog).getByRole("textbox", {
      name: i18n.t("plans.groups.portName"),
    }),
    { target: { value: "shared" } },
  );
}

/** Each member reads the boundary port through the handle beside it. */
function bindInternalPorts(): void {
  for (const name of ["Test 2", "Test 1"]) {
    fireEvent.click(
      within(frame()).getByRole("button", {
        name: i18n.t("plans.groups.portToMember", { name: "shared" }),
      }),
    );
    fireEvent.click(
      within(card(name)).getByRole("button", {
        name: i18n.t("plans.bindPort", { parameter: "shared", name }),
      }),
    );
  }
}

function connectOuterGraph(): void {
  fireEvent.click(
    within(card("Start")).getByRole("button", {
      name: i18n.t("plans.flowOut"),
    }),
  );
  fireEvent.click(
    within(frame()).getAllByRole("button", {
      name: i18n.t("plans.flowIn"),
    })[0] ?? document.body,
  );
  fireEvent.click(
    within(frame()).getAllByRole("button", {
      name: i18n.t("plans.flowOut"),
    })[0] ?? document.body,
  );
  fireEvent.click(
    within(card("Ende")).getByRole("button", { name: i18n.t("plans.flowIn") }),
  );
  fireEvent.click(
    within(card("spare")).getByRole("button", {
      name: i18n.t("plans.valueOut"),
    }),
  );
  fireEvent.click(
    within(frame()).getByRole("button", {
      name: i18n.t("plans.bindPort", { parameter: "shared", name: GROUP }),
    }),
  );
}

it("edits a group from its node menu on the canvas and saves an ordered subgraph with a visible shared port", async () => {
  const server = groupServer();
  const rendered = renderPlanPage(server);
  await screen.findByRole("region", { name: i18n.t("plans.canvas") });
  // The source tabs of the former side panel are gone; the canvas offers the group itself.
  // Only the palette has tabs, Nodes and Templates (PAGE-117).
  expect(
    screen
      .queryAllByRole("tab")
      .filter((tab) => !tab.closest("[data-plan-palette]")),
  ).toHaveLength(0);
  const dialog = await openGroupDialog();
  await addMembers(dialog);
  closeDialog(dialog);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  bindInternalPorts();
  connectOuterGraph();
  const reopened = await openGroupDialog();
  expect(
    within(reopened).getByRole("combobox", {
      name: i18n.t("plans.groups.externalSource", { name: "shared" }),
    }).textContent,
  ).toContain("spare");
  fireEvent.change(
    within(reopened).getByRole("textbox", {
      name: i18n.t("plans.groups.portName"),
    }),
    { target: { value: "common" } },
  );
  closeDialog(reopened);
  pressSave();
  await waitFor(() => expect(server.saved).toHaveLength(1));
  const group = server.saved[0]?.nodes.find((node) => node.type === "group");
  if (group?.type !== "group") throw new Error("Missing saved group");
  expect(group.steps.map((step) => step.agentId)).toEqual([
    "agent-1",
    "agent-0",
  ]);
  expect(group.bindings.common).toEqual({ kind: "source", nodeId: "spare" });
  expect(group.bindings.shared).toBeUndefined();
  expect(group.steps.map((step) => step.bindings.shared)).toEqual([
    { kind: "source", nodeId: group.parameters[0]?.id },
    { kind: "source", nodeId: group.parameters[0]?.id },
  ]);
  expect(server.saved[0]?.edges).toHaveLength(2);
  rendered.unmount();
  renderPlanPage(server);
  await screen.findByRole("region", { name: i18n.t("plans.canvas") });
  const saved = await openGroupDialog();
  expect(
    within(saved).getByRole("list", { name: i18n.t("plans.groups.order") }),
  ).toBeDefined();
  fireEvent.click(
    within(saved).getByRole("button", {
      name: i18n.t("plans.groups.removePort"),
    }),
  );
  closeDialog(saved);
  // Without the port the members lose their source; the cards mark the issue
  // and the panel keeps Play disabled until the graph can be run.
  await waitFor(() =>
    expect(card("Test 2").className).toContain("border-destructive"),
  );
  expect(card("Test 1").className).toContain("border-destructive");
  expect(screen.getByRole("button", { name: "Play" })).toHaveProperty(
    "disabled",
    true,
  );
}, 20_000);
