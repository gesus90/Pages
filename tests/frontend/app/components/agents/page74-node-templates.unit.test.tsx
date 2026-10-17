import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";

import {
  i18n,
  planServer,
  renderPlanPage,
  SOURCES,
} from "./page61-plan-fixture";

import type { AgentPlanSources } from "@/definition/AgentPlan";
import type { PlanServer } from "./page61-plan-fixture";

const scrollIntoView = HTMLElement.prototype.scrollIntoView;
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterAll(() => {
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
});

function sources(): AgentPlanSources {
  const agent = SOURCES.agents[0];
  return {
    agents: [
      {
        ...agent,
        modelProfileId: "model-a",
        model: "M",
        reasoningEffort: "low",
        configuration: {
          ...agent.configuration,
          markdown: "X",
          parameters: [],
        },
      },
    ],
    tasks: [],
    models: [
      {
        id: "model-a",
        name: "Model A",
        model: "M",
        provider: "openrouter",
        reasoning: "levels",
        reasoningEfforts: ["low", "high"],
        catalogDefaultReasoningEffort: "low",
        reasoningEffort: "low",
      },
      {
        id: "model-b",
        name: "Model B",
        model: "N",
        provider: "openrouter",
        reasoning: "levels",
        reasoningEfforts: ["low", "high"],
        catalogDefaultReasoningEffort: "low",
        reasoningEffort: "low",
      },
    ],
  };
}

function serverWithCopies(canEdit = true): PlanServer {
  const server = planServer(canEdit);
  const current = sources();
  server.sources = current;
  if (!server.plan) throw new Error("Missing plan");
  server.plan = {
    ...server.plan,
    nodes: server.plan.nodes.map((node) =>
      node.type === "agent"
        ? {
            ...node,
            agentId: "reviewer",
            bindings: {},
            configuration: copyPlanConfiguration(current.agents[0]),
          }
        : node,
    ),
  };
  return server;
}

/** A double click opens the agent console; the node dialog opens from the action menu. */
async function openNodeDialog(card: HTMLElement): Promise<void> {
  fireEvent.keyDown(
    within(card).getByRole("button", {
      name: i18n.t("settings.agents.actionsFor", { name: "Reviewer" }),
    }),
    { key: "Enter" },
  );
  fireEvent.click(
    await screen.findByRole("menuitem", {
      name: i18n.t("settings.agents.edit"),
    }),
  );
}

async function choose(label: string, option: string): Promise<void> {
  const dialog = screen.getByRole("dialog");
  fireEvent.keyDown(within(dialog).getByRole("combobox", { name: label }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

it("opens one of two copies from its menu, changes only its instruction/model/reasoning, and persists it", async () => {
  const server = serverWithCopies();
  renderPlanPage(server);
  const cards = await screen.findAllByRole("article", { name: "Reviewer" });
  await openNodeDialog(cards[0]);
  const dialog = await screen.findByRole("dialog", {
    name: i18n.t("plans.editNode"),
  });
  expect(
    within(dialog).getAllByText(i18n.t("plans.nodeConfigurationHint")),
  ).not.toHaveLength(0);
  fireEvent.change(
    within(dialog).getByLabelText(i18n.t("plans.nodeMarkdown")),
    { target: { value: "Y" } },
  );
  await choose(i18n.t("pageAgents.model"), "Model B · N");
  await choose(i18n.t("pageAgents.reasoning"), "high");
  fireEvent.click(
    within(dialog).getByRole("button", { name: i18n.t("plans.closeNode") }),
  );
  const sidebar = screen.getByRole("region", {
    name: i18n.t("plans.agentSources"),
  });
  fireEvent.click(within(sidebar).getByRole("button", { name: /Reviewer/ }));
  await waitFor(() =>
    expect(screen.getAllByRole("article", { name: "Reviewer" })).toHaveLength(
      3,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: i18n.t("plans.save") }));
  await waitFor(() => expect(server.saved).toHaveLength(1));
  const nodes = server.saved[0].nodes.filter((node) => node.type === "agent");
  expect(nodes[0].configuration).toMatchObject({
    model: "N",
    modelProfileId: "model-b",
    reasoningEffort: "high",
    template: { markdown: "Y" },
  });
  expect(nodes[1].configuration).toMatchObject({
    model: "M",
    reasoningEffort: "low",
    template: { markdown: "X" },
  });
  expect(nodes[2].configuration).toMatchObject({
    model: "M",
    reasoningEffort: "low",
    template: { markdown: "X" },
  });
  expect(server.sources?.agents[0].configuration.markdown).toBe("X");
  await openNodeDialog(screen.getAllByRole("article", { name: "Reviewer" })[1]);
  expect(
    within(await screen.findByRole("dialog")).getByDisplayValue("X"),
  ).toBeDefined();
}, 20_000);

it("fetches the current template on every sidebar insertion and keeps previous copies unchanged", async () => {
  const server = serverWithCopies();
  renderPlanPage(server);
  const sidebar = await screen.findByRole("region", {
    name: i18n.t("plans.agentSources"),
  });
  const insert = within(sidebar).getByRole("button", { name: /Reviewer/ });
  fireEvent.click(insert);
  await waitFor(() =>
    expect(screen.getAllByRole("article", { name: "Reviewer" })).toHaveLength(
      3,
    ),
  );
  const current = sources();
  server.sources = {
    ...current,
    agents: [
      {
        ...current.agents[0],
        revision: 2,
        configuration: { ...current.agents[0].configuration, markdown: "Z" },
      },
    ],
  };
  fireEvent.click(insert);
  await waitFor(() =>
    expect(screen.getAllByRole("article", { name: "Reviewer" })).toHaveLength(
      4,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: i18n.t("plans.save") }));
  await waitFor(() => expect(server.saved).toHaveLength(1));
  const copies = server.saved[0].nodes.filter((node) => node.type === "agent");
  expect(copies.map((node) => node.configuration?.template.markdown)).toEqual([
    "X",
    "X",
    "X",
    "Z",
  ]);
  expect(copies.map((node) => node.configuration?.reasoningEffort)).toEqual([
    "low",
    "low",
    "low",
    "low",
  ]);
});

it("opens a read-only node dialog when the plan is shared without edit rights", async () => {
  renderPlanPage(serverWithCopies(false));
  await openNodeDialog(
    (await screen.findAllByRole("article", { name: "Reviewer" }))[0],
  );
  const dialog = await screen.findByRole("dialog");
  const textarea = within(dialog).getByLabelText(i18n.t("plans.nodeMarkdown"));
  expect(textarea.closest("fieldset")?.disabled).toBe(true);
});

it("refuses insertion when the current template cannot be loaded instead of reusing stale sidebar content", async () => {
  const server = serverWithCopies();
  renderPlanPage(server);
  const sidebar = await screen.findByRole("region", {
    name: i18n.t("plans.agentSources"),
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 403 }),
  );
  fireEvent.click(within(sidebar).getByRole("button", { name: /Reviewer/ }));
  expect(await screen.findByRole("alert")).toBeDefined();
  expect(
    screen.getByText(i18n.t("settings.agents.error.plan_sources_failed")),
  ).toBeDefined();
  expect(screen.getAllByRole("article", { name: "Reviewer" })).toHaveLength(2);
});
