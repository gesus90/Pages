import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanExecutionTargetField } from "@/app/components/agents/plans/plan-execution-target-field";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import {
  agentStep,
  EMPTY_SOURCES,
  i18n,
  renderTranslated,
} from "./plan-flow-fixture";

import type { AgentPlanSources } from "@/definition/AgentPlan";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { PageAgentModel } from "@/definition/PageAgent";

const MODEL: PageAgentModel = {
  id: "profile",
  connectionId: "openrouter-main",
  connectionName: "OpenRouter main",
  name: "Sonnet",
  model: "claude-sonnet",
  reasoning: "none",
  reasoningEfforts: [],
  catalogDefaultReasoningEffort: null,
  reasoningEffort: null,
  provider: "openrouter",
};

const SOURCES: AgentPlanSources = {
  ...EMPTY_SOURCES,
  models: [MODEL],
  remoteTargets: [
    {
      kind: "remote",
      connectionId: "nas",
      connectionRevision: 1,
      connectionName: "homeNAS",
      workspaceId: "pages",
      workspaceRevision: 1,
      workspaceName: "pageNAS",
      path: "/srv/pages",
    },
  ],
};

function configuration(
  overrides: Partial<AgentPlanConfiguration> = {},
): AgentPlanConfiguration {
  return {
    name: "Sonnet",
    revision: 1,
    modelProfileId: MODEL.id,
    connectionId: MODEL.connectionId,
    model: MODEL.model,
    provider: "openrouter",
    reasoningEffort: null,
    template: emptyAgentConfiguration(),
    ...overrides,
  };
}

function renderField(
  sources: AgentPlanSources,
  copy: AgentPlanConfiguration,
): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  renderTranslated(
    <PlanExecutionTargetField
      step={agentStep("writer")}
      planTarget={undefined}
      sources={sources}
      configuration={copy}
      onChange={onChange}
    />,
  );
  return onChange;
}

function modelAccess(): string | null {
  return (
    screen.getByText(i18n.t("plans.execution.modelAccess")).nextElementSibling
      ?.textContent ?? null
  );
}

it("gives the node its own registered target", async () => {
  const onChange = renderField(SOURCES, configuration());

  fireEvent.keyDown(
    screen.getByRole("combobox", { name: i18n.t("plans.execution.target") }),
    { key: "Enter" },
  );
  fireEvent.click(
    await screen.findByRole("option", { name: "pageNAS · homeNAS" }),
  );

  expect(onChange).toHaveBeenCalledWith({
    ...agentStep("writer"),
    executionTarget: { kind: "remote", workspaceId: "pages" },
  });
});

it("names the connection of the node's model independently of the target", () => {
  renderField(SOURCES, configuration());

  expect(modelAccess()).toBe("OpenRouter main");
});

it("falls back to the stored connection when the model is not offered", () => {
  renderField(SOURCES, configuration({ model: "claude-retired" }));

  expect(modelAccess()).toBe("openrouter-main");
});

it("reports a model access without catalog or connection as unavailable", async () => {
  renderField(EMPTY_SOURCES, configuration({ connectionId: undefined }));

  expect(modelAccess()).toBe(i18n.t("plans.execution.unavailable"));
  fireEvent.keyDown(
    screen.getByRole("combobox", { name: i18n.t("plans.execution.target") }),
    { key: "Enter" },
  );
  expect(await screen.findAllByRole("option")).toHaveLength(2);
});
