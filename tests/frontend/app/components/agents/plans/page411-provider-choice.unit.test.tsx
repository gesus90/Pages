import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, it } from "vitest";

import { AgentRunOptionsFields } from "@/app/components/settings/agents/agent-run-options-fields";
import { PlanStatusConfiguration } from "@/app/components/agents/plans/plan-status-configuration";
import { modelGroups } from "@/app/components/agents/model-picker/model-catalog";
import { planDecisionModelRefusal } from "@/app/components/agents/plans/plan-decision-dialog/plan-decision-form";
import { createI18n } from "@/app/lib/i18n";
import {
  emptyAgentConfiguration,
  defaultAgentRunOptions,
} from "@/definition/AgentConfiguration";

import { pageModel } from "./plan-model-fixture";

import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

const i18n = createI18n("de");
afterEach(cleanup);

it.each(["openrouter", "zai"] as const)(
  "offers %s independently in model and decision choices with both isolated modes",
  (provider) => {
    const label = provider === "openrouter" ? "OpenRouter" : "Z.AI";
    const model = pageModel(provider, {
      provider,
      model: "deepseek/deepseek-v4.1-flash",
      connectionName: label,
    });
    const groups = modelGroups([model], { translate: i18n.t });
    expect(groups[0]?.key).toBe(provider);
    expect(groups[0]?.sources[0]?.choices[0]?.model.model).toBe(
      "deepseek/deepseek-v4.1-flash",
    );
    expect(JSON.stringify(groups)).not.toContain("OpenCode");
    expect(planDecisionModelRefusal(model)).toBe(false);
    render(
      <I18nextProvider i18n={i18n}>
        <AgentRunOptionsFields
          configuration={{
            ...emptyAgentConfiguration(),
            run: defaultAgentRunOptions(provider),
          }}
          provider={provider}
          disabled={false}
          onChange={() => undefined}
        />
      </I18nextProvider>,
    );
    expect(screen.getByRole("combobox").textContent).toContain("Nur Lesen");
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: /YOLO/u })).not.toBeNull();
  },
);

it.each(["openrouter", "zai"] as const)(
  "shows %s's public identity and catalog ID in the run configuration",
  (provider) => {
    const session: AgentPlanSessionRecord = {
      runner: provider,
      mode: "interactive",
      instanceId: "instance",
      sessionId: "native-session",
      processId: 411,
      startedAt: null,
      turnEndedAt: null,
      endedAt: null,
      exit: null,
      closeout: "pending",
      leftoverProcesses: null,
      resultCode: null,
      requested: {
        runner: provider,
        connectionId: "selected",
        connectionName: provider === "openrouter" ? "OpenRouter" : "z.AI",
        model: "deepseek/deepseek-v4.1-flash",
        reasoningEffort: "low",
        options: defaultAgentRunOptions(provider),
        unattended: "ACP",
        mcp: true,
        directory: "/workspace",
      },
      effective: {
        model: "deepseek/deepseek-v4.1-flash",
        reasoningEffort: "low",
      },
      definition: null,
      contract: null,
      acceptance: null,
      events: [],
    };
    render(
      <I18nextProvider i18n={i18n}>
        <PlanStatusConfiguration
          session={session}
          end={null}
          isRunning={true}
        />
      </I18nextProvider>,
    );
    expect(
      screen.getByText(provider === "openrouter" ? "OpenRouter" : "z.AI"),
    ).not.toBeNull();
    expect(screen.getByText("deepseek/deepseek-v4.1-flash")).not.toBeNull();
    expect(screen.queryByText(/OpenCode/iu)).toBeNull();
  },
);
