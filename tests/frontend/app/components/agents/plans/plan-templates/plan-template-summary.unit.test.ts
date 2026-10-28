import { expect, it } from "vitest";

import {
  planTemplateDetails,
  planTemplateError,
  planTemplateSaveDetails,
  planTemplateSuggestion,
} from "@/app/components/agents/plans/plan-templates/plan-template-summary";
import { createI18n } from "@/app/lib/i18n";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import {
  agentStep,
  EMPTY_SOURCES,
  groupNode,
  planOf,
  scriptStep,
} from "../plan-flow-fixture";
import { parameterNode } from "./template-fixture";

import type { PlanValueContext } from "@/app/components/agents/plans/plan-node-card/plan-value-preview";
import type { AgentPlanSources, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";

const i18n = createI18n("en");
const t = i18n.getFixedT("en");
const { markdown, parameters, directoryParameter } = emptyAgentConfiguration();
const CONFIGURATION: AgentPlanConfiguration = {
  name: "Reviewer copy",
  revision: 1,
  modelProfileId: "profile",
  model: "vendor/model",
  provider: "openrouter",
  reasoningEffort: "high",
  template: { markdown, parameters, directoryParameter },
};

function context(sources: AgentPlanSources = EMPTY_SOURCES): PlanValueContext {
  return { draft: planOf([]), sources, workspaces: [], translate: t };
}

function configured(
  configuration: AgentPlanConfiguration | undefined,
): AgentPlanStep {
  return { ...agentStep("agent"), agentId: "reviewer", configuration };
}

it("suggests the name a node card shows", () => {
  expect(planTemplateSuggestion(configured(CONFIGURATION), context())).toBe(
    "Reviewer copy",
  );
  expect(planTemplateSuggestion(parameterNode(), context())).toBe("topic");
  expect(planTemplateSuggestion(groupNode("g", []), context())).toBe("Group g");
});

it("counts the agents of a group", () => {
  const group = groupNode("g", [agentStep("a"), agentStep("b")]);
  expect(planTemplateDetails(group, context())).toEqual(["2 agents"]);
  expect(planTemplateSaveDetails(group, context())).toEqual(["2 agents"]);
});

it("names a script's interpreter profile, or its identifier when the profile is gone", () => {
  const script = scriptStep("s", 1);
  const sources: AgentPlanSources = {
    ...EMPTY_SOURCES,
    interpreters: [
      {
        id: "bash",
        name: "Bash 5",
        status: "ok",
        version: "5.2",
        error: null,
      },
    ],
  };
  expect(planTemplateDetails(script, context(sources))).toEqual(["Bash 5"]);
  expect(planTemplateDetails(script, context())).toEqual(["bash"]);
  expect(
    planTemplateSaveDetails(
      { ...script, inputs: [{ name: "one", type: "text", isRequired: false }] },
      context({ ...EMPTY_SOURCES, interpreters: [] }),
    ),
  ).toEqual(["bash", "1 input"]);
});

it("shows a parameter's value type and a shortened value", () => {
  const long = parameterNode({
    value: { type: "text", text: `  ${"word ".repeat(12)}` },
  });
  const [kind, value] = planTemplateDetails(long, context());
  expect(kind).toBe(t("plans.valueTypes.string"));
  expect(value).toBe(`${"word ".repeat(8).slice(0, 39)}…`);
  expect(
    planTemplateDetails(
      parameterNode({ format: "number", value: { type: "number", number: 3 } }),
      context(),
    ),
  ).toEqual([t("plans.valueTypes.number"), "3"]);
  expect(
    planTemplateDetails(
      parameterNode({ value: { type: "text", text: "" } }),
      context(),
    ),
  ).toEqual([t("plans.valueTypes.string")]);
});

it("names an agent's model and reasoning effort, preferring the catalog name", () => {
  const sources: AgentPlanSources = {
    ...EMPTY_SOURCES,
    models: [
      {
        id: "profile",
        name: "Catalog model",
        model: "vendor/model",
        reasoning: "levels",
        reasoningEfforts: ["high"],
        catalogDefaultReasoningEffort: null,
        reasoningEffort: null,
        provider: "openrouter",
      },
    ],
  };
  expect(
    planTemplateDetails(configured(CONFIGURATION), context(sources)),
  ).toEqual(["Catalog model", "high"]);
  expect(
    planTemplateDetails(
      configured({ ...CONFIGURATION, reasoningEffort: null }),
      context(),
    ),
  ).toEqual(["vendor/model"]);
  expect(
    planTemplateDetails(
      configured(CONFIGURATION),
      context({ ...EMPTY_SOURCES, models: [] }),
    ),
  ).toEqual(["vendor/model", "high"]);
  expect(planTemplateDetails(configured(undefined), context())).toEqual([]);
});

it("translates a refusal from the agent errors, the execution errors or as general", () => {
  expect(planTemplateError(t, "name_taken")).toBe(
    t("settings.agents.error.name_taken"),
  );
  expect(planTemplateError(t, "requestBusy")).toBe(
    t("agentExecution.error.requestBusy"),
  );
  expect(planTemplateError(t, "unknown_code")).toBe(
    t("settings.agents.error.general"),
  );
});
