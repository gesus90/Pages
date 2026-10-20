import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { acpRunOptions } from "@/definition/AgentConfiguration";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";

import {
  i18n,
  planServer,
  pressSave,
  renderPlanPage,
  SOURCES,
} from "./page61-plan-fixture";

import type { AgentPlanSources } from "@/definition/AgentPlan";
import type { PlanServer } from "./page61-plan-fixture";

const GROUP = i18n.t("plans.groups.defaultName");

const scrollIntoView = HTMLElement.prototype.scrollIntoView;
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterAll(() => {
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
});

/** The Reviewer template; an ACP template may also join a group, where insertions happen now. */
function sources(
  provider: "openrouter" | "codex_cli" = "openrouter",
): AgentPlanSources {
  const agent = SOURCES.agents[0];
  return {
    agents: [
      {
        ...agent,
        provider,
        modelProfileId: "model-a",
        model: "M",
        reasoningEffort: "low",
        configuration: {
          ...agent.configuration,
          markdown: "X",
          parameters: [],
          ...(provider === "codex_cli"
            ? { run: acpRunOptions("read_only", 0) }
            : {}),
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

function serverWithCopies(
  canEdit = true,
  provider: "openrouter" | "codex_cli" = "openrouter",
): PlanServer {
  const server = planServer(canEdit);
  const current = sources(provider);
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

/** Two ACP copies and an empty group, whose dialog inserts further copies. */
function serverWithGroup(): PlanServer {
  const server = serverWithCopies(true, "codex_cli");
  if (!server.plan) throw new Error("Missing plan");
  server.plan = {
    ...server.plan,
    nodes: [
      ...server.plan.nodes,
      {
        id: "group",
        type: "group",
        name: GROUP,
        x: 1280,
        y: 0,
        steps: [],
        parameters: [],
        bindings: {},
      },
    ],
  };
  return server;
}

/** Opens the group dialog from the frame's edit button, unless it is open, and inserts one Reviewer copy. */
async function insertIntoGroup(): Promise<HTMLElement> {
  if (!screen.queryByRole("dialog")) {
    const frame = await screen.findByRole("region", {
      name: i18n.t("plans.groups.frame", { name: GROUP }),
    });
    fireEvent.click(
      within(frame).getByRole("button", {
        name: i18n.t("plans.editNamed", { name: GROUP }),
      }),
    );
  }
  const dialog = await screen.findByRole("dialog", {
    name: i18n.t("plans.groups.panel.label", { name: GROUP }),
  });
  fireEvent.keyDown(
    within(dialog).getByRole("combobox", {
      name: i18n.t("plans.groups.addAgent"),
    }),
    { key: "Enter" },
  );
  fireEvent.click(await screen.findByRole("option", { name: /^Reviewer ·/ }));
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: i18n.t("plans.groups.addAgent"),
    }),
  );
  return dialog;
}

/** A double click opens the agent console; the node dialog opens from the edit button. */
async function openNodeDialog(card: HTMLElement): Promise<void> {
  fireEvent.click(
    await within(card).findByRole("button", {
      name: i18n.t("plans.editNamed", { name: "Reviewer" }),
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
  pressSave();
  await waitFor(() => expect(server.saved).toHaveLength(1));
  const nodes = server.saved[0].nodes.filter((node) => node.type === "agent");
  expect(nodes).toHaveLength(2);
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
  expect(server.sources?.agents[0].configuration.markdown).toBe("X");
  await openNodeDialog(screen.getAllByRole("article", { name: "Reviewer" })[1]);
  expect(
    within(await screen.findByRole("dialog")).getByDisplayValue("X"),
  ).toBeDefined();
}, 20_000);

it("fetches the current template on every insertion into a group and keeps previous copies unchanged", async () => {
  const server = serverWithGroup();
  renderPlanPage(server);
  const dialog = await insertIntoGroup();
  await waitFor(() =>
    expect(
      screen.getAllByRole("article", { name: "Reviewer", hidden: true }),
    ).toHaveLength(3),
  );
  const current = sources("codex_cli");
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
  await insertIntoGroup();
  await waitFor(() =>
    expect(
      screen.getAllByRole("article", { name: "Reviewer", hidden: true }),
    ).toHaveLength(4),
  );
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: i18n.t("plans.groups.panel.closeButton"),
    }),
  );
  pressSave();
  await waitFor(() => expect(server.saved).toHaveLength(1));
  const copies = server.saved[0].nodes.flatMap((node) => {
    if (node.type === "agent") return [node];
    return node.type === "group" ? node.steps : [];
  });
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

it("refuses insertion when the current template cannot be loaded instead of reusing stale page sources", async () => {
  const server = serverWithGroup();
  renderPlanPage(server);
  await screen.findByRole("region", {
    name: i18n.t("plans.groups.frame", { name: GROUP }),
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 403 }),
  );
  const dialog = await insertIntoGroup();
  expect(await within(dialog).findByRole("alert")).toBeDefined();
  expect(
    within(dialog).getByText(
      i18n.t("settings.agents.error.plan_sources_failed"),
    ),
  ).toBeDefined();
  expect(
    screen.getAllByRole("article", { name: "Reviewer", hidden: true }),
  ).toHaveLength(2);
});
