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
}

it("edits a group from its node menu on the canvas and saves its agents in order, without any boundary port", async () => {
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
  // A group is a session container (PAGE-113): no port can be added to it any more.
  expect(
    within(dialog).queryByRole("button", {
      name: i18n.t("plans.groups.addPort"),
    }),
  ).toBeNull();
  await addMembers(dialog);
  closeDialog(dialog);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  pressSave();
  await waitFor(() => expect(server.saved).toHaveLength(1));
  const group = server.saved[0]?.nodes.find((node) => node.type === "group");
  if (group?.type !== "group") throw new Error("Missing saved group");
  expect(group.steps.map((step) => step.agentId)).toEqual([
    "agent-1",
    "agent-0",
  ]);
  expect(group.parameters).toEqual([]);
  expect(group.bindings).toEqual({});
  rendered.unmount();
  renderPlanPage(server);
  await screen.findByRole("region", { name: i18n.t("plans.canvas") });
  const saved = await openGroupDialog();
  const order = within(
    within(saved).getByRole("list", { name: i18n.t("plans.groups.order") }),
  );
  expect(
    order.getAllByRole("listitem").map((item) => item.textContent),
  ).toEqual([
    expect.stringContaining("Test 2"),
    expect.stringContaining("Test 1"),
  ]);
}, 20_000);
