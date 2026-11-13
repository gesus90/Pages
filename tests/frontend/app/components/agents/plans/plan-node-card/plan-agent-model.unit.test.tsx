import { fireEvent, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanAgentModel } from "@/app/components/agents/plans/plan-node-card/plan-agent-model";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { agentModelKey } from "@/definition/AgentPlanConfiguration";

import {
  modelTrigger,
  openModelRows,
} from "../../definitions/page-agent-fixture";
import { SOURCES } from "../../page61-plan-fixture";
import {
  agentStep,
  flowContext,
  graphActions,
  groupNode,
  i18n,
  planOf,
  renderInFlow,
} from "../plan-flow-fixture";
import { pageModel } from "../plan-model-fixture";

import type { PlanGraphActions } from "@/app/components/agents/plans/use-plan-graph";
import type { AgentPlanInput, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { PageAgentModel } from "@/definition/PageAgent";

const LEVELS = pageModel("levels", {
  name: "Level model",
  reasoning: "levels",
  reasoningEfforts: ["low", "high"],
  provider: "openai",
  contextWindow: 128000,
  maxOutputTokens: 8000,
  isFree: true,
});
const OTHER = pageModel("other", { name: "Other model", provider: "openai" });

function configuration(
  overrides: Partial<AgentPlanConfiguration> = {},
): AgentPlanConfiguration {
  const { markdown, parameters, directoryParameter } =
    emptyAgentConfiguration();
  return {
    name: "Own node",
    revision: 1,
    modelProfileId: "levels",
    connectionId: "connection",
    model: "vendor/levels",
    provider: "openai",
    reasoningEffort: null,
    template: { markdown, parameters, directoryParameter },
    ...overrides,
  };
}

function step(overrides: Partial<AgentPlanConfiguration> = {}): AgentPlanStep {
  return { ...agentStep("node"), configuration: configuration(overrides) };
}

interface ModelSetup {
  readonly step: AgentPlanStep;
  readonly models?: readonly PageAgentModel[];
  readonly canEdit?: boolean;
  readonly draft?: AgentPlanInput;
}

function renderModel(setup: ModelSetup): PlanGraphActions {
  const graph = graphActions();
  renderInFlow(
    <PlanAgentModel step={setup.step} />,
    flowContext({
      graph,
      canEdit: setup.canEdit ?? true,
      sources: { ...SOURCES, models: setup.models },
      draft: setup.draft ?? planOf([setup.step]),
    }),
  );
  return graph;
}

function footer(): HTMLElement {
  const element = document.querySelector("footer");
  if (!(element instanceof HTMLElement)) throw new Error("No footer");
  return element;
}

async function openSelect(name: string): Promise<readonly HTMLElement[]> {
  fireEvent.keyDown(screen.getByRole("combobox", { name }), { key: "Enter" });
  await screen.findByRole("listbox");
  return screen.getAllByRole("option");
}

function openModels(): Promise<readonly HTMLElement[]> {
  return openModelRows(modelTrigger(MODEL));
}

function rowNamed(rows: readonly HTMLElement[], name: string): HTMLElement {
  const row = rows.find((entry) => entry.textContent?.includes(name));
  if (!row) throw new Error(`No model row ${name}`);
  return row;
}

const MODEL = i18n.t("pageAgents.model");
const REASONING = i18n.t("pageAgents.reasoning");

it("says that a node without a configuration or agent has no model", () => {
  renderModel({ step: { ...agentStep("node"), agentId: "gone" } });
  expect(footer().textContent).toBe(i18n.t("pageAgents.missingModel"));
});

it("shows the agent's model and default reasoning read only without edit rights", () => {
  renderModel({
    step: { ...agentStep("node"), agentId: "reviewer" },
    models: [pageModel("synthetic", { model: "synthetic-free:free" })],
    canEdit: false,
  });
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(footer().textContent).toContain("synthetic-free:free");
  expect(footer().textContent).toContain(i18n.t("pageAgents.defaultReasoning"));
  expect(footer().textContent).toContain(i18n.t("pageAgents.missingModel"));
});

it("shows a listed model by its name and the saved reasoning read only", () => {
  renderModel({
    step: step({ reasoningEffort: "high" }),
    models: [LEVELS],
    canEdit: false,
  });
  const [model, reasoning] = footer().querySelectorAll("p");
  expect(model?.textContent).toBe(`${MODEL}: Level model`);
  expect(model?.getAttribute("title")).toBe(`${MODEL}: Level model`);
  expect(reasoning?.textContent).toBe(`${REASONING}: high`);
});

it("shows the saved values while no model is released for the target", () => {
  renderModel({ step: step(), models: undefined });
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(footer().querySelector("p")?.getAttribute("title")).toBe(
    `${MODEL}: vendor/levels · ${i18n.t("pageAgents.missingModel")}`,
  );
});

it("lists the released models with their free badge and pins a chosen one", async () => {
  const node = step({ reasoningEffort: "low" });
  const graph = renderModel({ step: node, models: [LEVELS, OTHER] });
  const rows = await openModels();
  expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
    `Level model, ${i18n.t("plans.modelPicker.free")}`,
    "Other model",
  ]);
  fireEvent.click(rowNamed(rows, "Other model"));
  expect(graph.replaceNode).toHaveBeenCalledWith({
    ...node,
    configuration: {
      ...node.configuration,
      modelProfileId: "other",
      connectionId: "connection",
      runnerRoute: undefined,
      model: "vendor/other",
      provider: "openai",
      reasoningEffort: null,
    },
  });
});

it("sets a supported reasoning level and returns to the default", async () => {
  const node = step({ reasoningEffort: "low" });
  const graph = renderModel({ step: node, models: [LEVELS] });
  await openSelect(REASONING);
  fireEvent.click(screen.getByRole("option", { name: "high" }));
  expect(graph.replaceNode).toHaveBeenLastCalledWith({
    ...node,
    configuration: {
      ...node.configuration,
      runnerRoute: undefined,
      reasoningEffort: "high",
    },
  });
  await openSelect(REASONING);
  fireEvent.click(
    screen.getByRole("option", { name: i18n.t("pageAgents.defaultReasoning") }),
  );
  expect(graph.replaceNode).toHaveBeenLastCalledWith({
    ...node,
    configuration: {
      ...node.configuration,
      runnerRoute: undefined,
      reasoningEffort: null,
    },
  });
});

it("keeps a withdrawn model selected as missing and changes no level without a model", () => {
  const node = step({ model: "vendor/gone", reasoningEffort: "high" });
  const graph = renderModel({ step: node, models: [LEVELS] });
  expect(modelTrigger(MODEL).textContent).toContain(
    `vendor/gone · ${i18n.t("pageAgents.missingModel")}`,
  );
  const reasoning = screen.getByRole("combobox", { name: REASONING });
  expect(reasoning.hasAttribute("disabled")).toBe(true);
  fireEvent.keyDown(reasoning, { key: "Enter" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(graph.replaceNode).not.toHaveBeenCalled();
  expect(modelTrigger(MODEL).getAttribute("aria-expanded")).toBe("false");
});

it("selects the listed model a saved alias stands for", async () => {
  const claude = pageModel("claude", {
    name: "Sonnet",
    provider: "claude_code",
    model: "claude-sonnet-4-5",
    aliases: ["sonnet"],
  });
  renderModel({
    step: step({
      modelProfileId: agentModelKey("connection", "sonnet"),
      model: "sonnet",
      provider: "claude_code",
    }),
    models: [claude],
  });
  expect(modelTrigger(MODEL).textContent).toContain("Sonnet");
  const [row] = await openModels();
  expect(row?.getAttribute("aria-selected")).toBe("true");
});

it("disables models a group member cannot share and names the group's adapter", async () => {
  const member = step({ provider: "codex_cli" });
  const partner = {
    ...agentStep("partner"),
    configuration: configuration({ provider: "claude_code" }),
  };
  const group = groupNode("group", [member, partner]);
  renderModel({
    step: member,
    models: [
      pageModel("claude", { name: "Claude", provider: "claude_code" }),
      pageModel("codex", { name: "Codex", provider: "codex_cli" }),
      OTHER,
    ],
    draft: planOf([group]),
  });
  const rows = await openModels();
  const codex = rowNamed(rows, "Codex");
  const other = rowNamed(rows, "Other model");
  expect(codex.getAttribute("aria-disabled")).toBe("true");
  expect(codex.textContent).toContain(
    i18n.t("plans.modelRefusal.otherAdapter", {
      runner: i18n.t("settings.agents.providerShort.codex_cli"),
      adapter: i18n.t("settings.agents.providerShort.claude_code"),
    }),
  );
  expect(other.textContent).toContain(
    i18n.t("plans.modelRefusal.notAcp", {
      runner: i18n.t("settings.agents.providerShort.openai"),
      adapter: i18n.t("settings.agents.providerShort.claude_code"),
    }),
  );
});

it("refuses API models for the only member of a group without naming an adapter", async () => {
  const member = step();
  renderModel({
    step: member,
    models: [OTHER],
    draft: planOf([groupNode("group", [member])]),
  });
  const other = rowNamed(await openModels(), "Other model");
  expect(other.getAttribute("aria-disabled")).toBe("true");
  expect(other.textContent).toContain(
    i18n.t("plans.modelRefusal.notAcp", {
      runner: i18n.t("settings.agents.providerShort.openai"),
      adapter: "",
    }),
  );
});
