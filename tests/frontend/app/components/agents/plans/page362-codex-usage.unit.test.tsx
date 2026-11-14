import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, it, vi } from "vitest";

import { CodexUsageFacts } from "@/app/components/agents/plans/codex-usage-facts";
import { PlanCodexUsage } from "@/app/components/agents/plans/plan-codex-usage";
import { CodexPriceMappingFields } from "@/app/components/settings/agents/codex-price-mapping-fields";
import { CodexCostLimitField } from "@/app/components/settings/agents/agent-run-options-fields/codex-cost-limit-field";
import { createI18n } from "@/app/lib/i18n";
import { GLOBAL_CONNECTION_SCOPE } from "@/definition/AgentConnectionScope";

import { agentSession, runStep } from "./plan-panel-fixture";

import type { CodexUsageSummary } from "@/definition/CodexPlanUsage";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentForm } from "@/app/components/settings/agents/use-agent-form";

const i18n = createI18n("de");
const SUMMARY: CodexUsageSummary = {
  inputTokens: 100,
  cacheReadTokens: 40,
  outputTokens: 30,
  reasoningTokens: 10,
  costUsd: 0.464,
  isSubscription: true,
  isPartial: false,
  isPriceUnknown: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function translated(element: React.ReactElement): ReturnType<typeof render> {
  return render(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>);
}

function run(): AgentPlanRun {
  return {
    id: "run",
    planId: "plan",
    planName: "Plan",
    planRevision: 1,
    userId: "executor",
    startedAt: "2026-11-14",
    status: "running",
    stopRequested: false,
    steps: [
      runStep("step", {
        name: "Codex step",
        session: agentSession("codex_cli", { attemptId: "attempt" }),
      }),
    ],
  };
}

it("renders every token kind and the subscription equivalent with a price hint", () => {
  translated(<CodexUsageFacts usage={SUMMARY} />);
  for (const label of [
    "Eingabe:",
    "davon Cache:",
    "Ausgabe:",
    "davon Reasoning:",
    "Kosten:",
  ])
    expect(screen.getByText(label)).toBeDefined();
  expect(screen.getByText(/im Abo/u).textContent).toContain("0,464");
  expect(screen.getByTitle(/Rechnerischer Betrag/u)).toBeDefined();
});

it("shows unreported tokens and incomplete sums instead of zero, and unknown prices instead of free costs", () => {
  const view = translated(
    <CodexUsageFacts
      usage={{
        ...SUMMARY,
        inputTokens: null,
        cacheReadTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        costUsd: null,
        isPartial: true,
      }}
    />,
  );
  expect(screen.getAllByText("nicht gemeldet")).toHaveLength(5);
  expect(screen.getByText(/Summe unvollständig/u)).toBeDefined();
  expect(screen.queryByText("0")).toBeNull();
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <CodexUsageFacts
        usage={{ ...SUMMARY, costUsd: null, isPriceUnknown: true }}
      />
    </I18nextProvider>,
  );
  expect(screen.getByText("Preis unbekannt")).toBeDefined();
  expect(screen.queryByText(/0,00/u)).toBeNull();
});

it("refreshes the run and step counters while a Codex agent is still working, and releases polling on unmount", async () => {
  const current = run();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          view: {
            codexRunUsage: {
              total: SUMMARY,
              steps: [{ stepId: "step", usage: SUMMARY }],
            },
          },
        }),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const view = translated(<PlanCodexUsage run={current} />);
  await waitFor(() => expect(screen.getAllByText(/im Abo/u)).toHaveLength(2));
  expect(screen.getByText("Codex step")).toBeDefined();
  expect(fetcher.mock.calls[0][0]).toContain(
    "/agent-api/plan-runs/run/steps/step/session?attemptId=attempt&planId=plan",
  );
  vi.useFakeTimers();
  fetcher.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          view: {
            codexRunUsage: {
              total: { ...SUMMARY, inputTokens: 180 },
              steps: [
                { stepId: "step", usage: { ...SUMMARY, inputTokens: 180 } },
              ],
            },
          },
        }),
      ),
  );
  // Remount under fake timers so this test controls its polling deadline.
  view.unmount();
  const polling = translated(<PlanCodexUsage run={current} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(screen.getAllByText("180")).toHaveLength(2);
  const calls = fetcher.mock.calls.length;
  polling.unmount();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(fetcher).toHaveBeenCalledTimes(calls);
});

it("allows connection-specific model overrides and an optional monthly Codex limit", () => {
  const setField = vi.fn();
  const form: AgentForm = {
    fields: {
      name: "Codex",
      provider: "codex_cli",
      zaiAccountType: "",
      apiKey: "",
      testModel: "",
      reasoningEffort: "",
      scope: GLOBAL_CONNECTION_SCOPE,
      codexPriceMappings: "",
    },
    setField,
    isDirty: false,
    isSaving: false,
    savedCount: 0,
    error: null,
    handleSubmit: vi.fn(),
  };
  const change = vi.fn();
  translated(
    <>
      <CodexPriceMappingFields form={form} />
      <CodexCostLimitField limit={undefined} onChange={change} />
    </>,
  );
  fireEvent.change(
    screen.getByLabelText("OpenRouter-Preiszuordnung für Codex"),
    { target: { value: "gpt-6-luna = openai/gpt-6-luna" } },
  );
  expect(setField).toHaveBeenCalledWith(
    "codexPriceMappings",
    "gpt-6-luna = openai/gpt-6-luna",
  );
  fireEvent.change(screen.getByRole("spinbutton"), {
    target: { value: "2.5" },
  });
  expect(change).toHaveBeenCalledWith(2.5);
});
