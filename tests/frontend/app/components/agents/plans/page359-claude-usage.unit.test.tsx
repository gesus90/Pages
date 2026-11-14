import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { useState } from "react";
import { expect, it, vi } from "vitest";

import { ClaudeMonthlyBudgetField } from "@/app/components/users/agents/claude-monthly-budget-field";
import {
  createAgentDraft,
  agentDraftPayload,
} from "@/app/components/users/agents/agent-draft";
import { ClaudeUsageDetails } from "@/app/components/agents/plans/claude-usage-details";
import { PlanClaudeUsage } from "@/app/components/agents/plans/plan-claude-usage";
import { ClaudePriceFields } from "@/app/components/settings/agents/claude-price-fields";
import { createI18n } from "@/app/lib/i18n";
import { GLOBAL_CONNECTION_SCOPE } from "@/definition/AgentConnectionScope";

import type { PageAgentModel } from "@/definition/PageAgent";
import type { ClaudeUsageSummary } from "@/definition/ClaudeUsage";
import type { AgentForm } from "@/app/components/settings/agents/use-agent-form";

const i18n = createI18n("de");
const usage: ClaudeUsageSummary = {
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 1000,
  cacheWriteTokens: 200,
  costUsd: 0.00055,
  subscription: true,
  isIncomplete: false,
  hasUnknownPrice: false,
};

it("shows all four categories live and a subscription with the calculated OpenRouter amount", () => {
  const view = render(
    <I18nextProvider i18n={i18n}>
      <ClaudeUsageDetails usage={usage} />
    </I18nextProvider>,
  );
  for (const label of [
    "Eingabe-Token",
    "Ausgabe-Token",
    "Cache-Lese-Token",
    "Cache-Schreib-Token",
    "im Abo",
  ])
    expect(screen.getByText(label)).toBeDefined();
  expect(screen.getByText(/Rechnerisch:.*0,00055/u)).toBeDefined();
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <ClaudeUsageDetails usage={{ ...usage, inputTokens: 250 }} />
    </I18nextProvider>,
  );
  expect(screen.getByText("250")).toBeDefined();
});

it("shows unreported usage and unknown prices explicitly, with an incomplete total", () => {
  const view = render(
    <I18nextProvider i18n={i18n}>
      <ClaudeUsageDetails
        usage={{
          ...usage,
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          costUsd: null,
          isIncomplete: true,
        }}
      />
    </I18nextProvider>,
  );
  expect(screen.getAllByText("nicht gemeldet").length).toBe(5);
  expect(screen.getByText("Summe unvollständig")).toBeDefined();
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <ClaudeUsageDetails
        usage={{ ...usage, costUsd: null, hasUnknownPrice: true }}
      />
    </I18nextProvider>,
  );
  expect(screen.getByText("Preis unbekannt")).toBeDefined();
  expect(screen.queryByText("0,00 $", { exact: false })).toBeNull();
});

it("lists each iteration separately next to the sum of the run", () => {
  render(
    <I18nextProvider i18n={i18n}>
      <PlanClaudeUsage
        usage={{
          total: { ...usage, inputTokens: 300 },
          steps: [
            { attemptId: "iteration-1", name: "Ticket 1", usage },
            {
              attemptId: "iteration-2",
              name: "Ticket 2",
              usage: { ...usage, inputTokens: 200 },
            },
          ],
        }}
      />
    </I18nextProvider>,
  );
  expect(screen.getByText("1. Ticket 1")).toBeDefined();
  expect(screen.getByText("2. Ticket 2")).toBeDefined();
  expect(screen.getByText("300")).toBeDefined();
});

function PriceEditor(): React.ReactElement {
  const [mappings, setMappings] = useState("{}");
  const form: AgentForm = {
    fields: {
      name: "Claude",
      provider: "claude_code",
      zaiAccountType: "",
      apiKey: "",
      testModel: "claude-haiku-5-5",
      reasoningEffort: "low",
      scope: GLOBAL_CONNECTION_SCOPE,
      claudePriceModels: mappings,
    },
    setField: (key, next) => {
      if (key === "claudePriceModels" && typeof next === "string")
        setMappings(next);
    },
    isDirty: true,
    isSaving: false,
    savedCount: 0,
    error: null,
    handleSubmit: vi.fn(),
  };
  return <ClaudePriceFields form={form} />;
}

it("lets an administrator type and clear a per-model override, including intermediate incomplete IDs", () => {
  render(
    <I18nextProvider i18n={i18n}>
      <PriceEditor />
    </I18nextProvider>,
  );
  const input = screen.getByLabelText("claude-haiku-5-5");
  fireEvent.change(input, { target: { value: "anth" } });
  expect(screen.getByDisplayValue("anth")).toBeDefined();
  fireEvent.change(input, { target: { value: "anthropic/claude-haiku-5.5" } });
  expect(screen.getByDisplayValue("anthropic/claude-haiku-5.5")).toBeDefined();
  fireEvent.change(input, { target: { value: "" } });
  expect(input.getAttribute("value")).toBe("");
});

function budgetModel(provider: PageAgentModel["provider"]): PageAgentModel {
  return {
    id: "model",
    connectionId: "connection",
    name: "Haiku",
    model: "claude-haiku-5-5",
    provider,
    reasoning: "none",
    reasoningEfforts: [],
    catalogDefaultReasoningEffort: null,
    reasoningEffort: null,
  };
}

it("offers an optional budget only for Claude and sends it through the normal authorized agent editor", () => {
  const draft = {
    ...createAgentDraft(null, { roleId: "member", soul: "" }),
    modelKey: "model",
  };
  const onChange = vi.fn();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <ClaudeMonthlyBudgetField
        draft={draft}
        models={[budgetModel("claude_code")]}
        onChange={onChange}
        isDisabled={false}
      />
    </I18nextProvider>,
  );
  fireEvent.change(screen.getByRole("spinbutton"), {
    target: { value: "0.001" },
  });
  expect(onChange).toHaveBeenCalledWith("claudeMonthlyCostLimitUsd", "0.001");
  expect(
    JSON.parse(
      agentDraftPayload(
        { ...draft, claudeMonthlyCostLimitUsd: "0.001" },
        [budgetModel("claude_code")],
        null,
      ),
    ),
  ).toMatchObject({ claudeMonthlyCostLimitUsd: "0.001" });
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <ClaudeMonthlyBudgetField
        draft={draft}
        models={[budgetModel("codex_cli")]}
        onChange={onChange}
        isDisabled={false}
      />
    </I18nextProvider>,
  );
  expect(screen.queryByRole("spinbutton")).toBeNull();
});
