import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { PageAgentModelFields } from "@/app/components/agents/definitions/page-agent-model-fields";
import { PlanAgentAssignment } from "@/app/components/agents/plans/plan-agent-assignment";
import { createI18n } from "@/app/lib/i18n";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { planExecutionIssues } from "@/definition/AgentPlanGraph";

import type { AgentPlanSources, AgentPlanStep } from "@/definition/AgentPlan";
import type { PageAgentInput } from "@/definition/PageAgent";

const i18n = createI18n("de");
const scrollIntoView = HTMLElement.prototype.scrollIntoView;
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterAll(() => {
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
});

function ModelForm(): React.ReactElement {
  const [draft, setDraft] = useState<PageAgentInput>({
    name: "Retained agent",
    modelProfileId: "",
    reasoningEffort: null,
    configuration: emptyAgentConfiguration(),
  });
  return (
    <PageAgentModelFields
      draft={draft}
      models={[
        {
          id: "replacement",
          name: "Replacement",
          model: "model",
          reasoning: "none",
          reasoningEfforts: [],
          reasoningEffort: null,
          catalogDefaultReasoningEffort: null,
        },
      ]}
      disabled={false}
      isModelWithdrawn={draft.modelProfileId === ""}
      onChange={setDraft}
    />
  );
}

async function choose(label: string, option: string): Promise<void> {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

it("explains the missing model and lets the owner select a replacement", async () => {
  render(
    <I18nextProvider i18n={i18n}>
      <ModelForm />
    </I18nextProvider>,
  );
  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("pageAgents.modelWithdrawn"),
  );
  expect(
    screen.getByRole("combobox", { name: i18n.t("pageAgents.model") })
      .textContent,
  ).toContain(i18n.t("pageAgents.missingModel"));
  await choose(i18n.t("pageAgents.model"), "Replacement · model");
  expect(screen.queryByRole("status")).toBeNull();
  expect(
    screen.getByRole("combobox", { name: i18n.t("pageAgents.model") })
      .textContent,
  ).toContain("Replacement");
});

const SOURCES: AgentPlanSources = {
  tasks: [],
  agents: [
    {
      id: "replacement",
      name: "Replacement agent",
      model: "model",
      reasoningEffort: null,
      provider: "openrouter",
      purposes: ["agent"],
      revision: 1,
      configuration: { ...emptyAgentConfiguration(), accessMode: "personal" },
      availability: {
        isUsable: true,
        reason: null,
        personalChoices: [
          {
            id: "access",
            name: "Personal replacement",
            model: "model",
            reasoningEffort: null,
          },
        ],
      },
    },
  ],
};

function PlanAssignment(props: {
  readonly personal: boolean;
}): React.ReactElement {
  const [step, setStep] = useState<AgentPlanStep>({
    id: "step",
    type: "agent",
    x: 0,
    y: 0,
    agentId: props.personal ? "replacement" : "",
    personalAgentId: props.personal ? "" : null,
    instruction: "Retained input",
    bindings: {},
  });
  const issues = planExecutionIssues(
    {
      name: "Plan",
      workspaceId: "workspace",
      usage: "private",
      globals: {},
      nodes: [step],
      edges: [],
    },
    SOURCES.agents,
  );
  return (
    <>
      <PlanAgentAssignment
        step={step}
        sources={SOURCES}
        disabled={false}
        onChange={setStep}
      />
      <output aria-label="Assignment blocked">
        {String(
          issues.some(
            (issue) => issue.nodeId === "step" && issue.reason === "agent",
          ),
        )}
      </output>
      <p>{step.instruction}</p>
    </>
  );
}

it.each([false, true])(
  "blocks a removed assignment, explains it, and permits explicit reassignment (personal: %s)",
  async (personal) => {
    render(
      <I18nextProvider i18n={i18n}>
        <PlanAssignment personal={personal} />
      </I18nextProvider>,
    );
    expect(screen.getByLabelText("Assignment blocked").textContent).toBe(
      "true",
    );
    expect(
      screen.getByText(
        i18n.t(personal ? "plans.missingPersonalAccess" : "plans.missingAgent"),
      ),
    ).toBeDefined();
    await choose(
      i18n.t(personal ? "plans.personalAccess" : "plans.assignAgent"),
      personal ? "Personal replacement" : "Replacement agent",
    );
    expect(screen.getByLabelText("Assignment blocked").textContent).toBe(
      "false",
    );
    expect(screen.getByText("Retained input")).toBeDefined();
  },
);
