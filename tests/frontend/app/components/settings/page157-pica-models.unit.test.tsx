import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { AgentZaiAccountField } from "@/app/components/settings/agents/agent-zai-account-field";
import { picaModelOptions } from "@/app/components/settings/agents/pica-model-options";
import { createI18n } from "@/app/lib/i18n";
import { GLOBAL_CONNECTION_SCOPE } from "@/definition/AgentConnectionScope";

import type { ComponentProps } from "react";
import type { AgentForm } from "@/app/components/settings/agents/use-agent-form";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { PageAgentModel } from "@/definition/PageAgent";

vi.mock("@/app/components/ui/scroll-viewport", () => ({
  ScrollViewport: (props: ComponentProps<"div">): React.ReactElement => (
    <div {...props} />
  ),
}));

const MODEL: PageAgentModel = {
  id: "cli-model",
  provider: "opencode",
  name: "Model",
  model: "google/gemini-flash",
  reasoning: "none",
  reasoningEfforts: [],
  reasoningEffort: null,
  catalogDefaultReasoningEffort: null,
};

it("offers only Pica-compatible CLI models and keeps free OpenRouter visible", () => {
  const models: PageAgentModel[] = [
    MODEL,
    { ...MODEL, id: "zen", model: "opencode/free", isFree: true },
    { ...MODEL, id: "router", model: "openrouter/example:free", isFree: true },
    { ...MODEL, id: "api", provider: "openai", model: "gpt" },
  ];
  const options = picaModelOptions(models, createI18n("en").t);
  expect(options.map(({ value }) => value).toSorted()).toEqual([
    "cli-model",
    "router",
  ]);
});

function accountForm(provider: AgentProviderId, account = ""): AgentForm {
  return {
    fields: {
      name: "z.ai",
      provider,
      apiKey: "",
      testModel: "",
      reasoningEffort: "",
      scope: GLOBAL_CONNECTION_SCOPE,
      zaiAccountType: account,
    },
    setField: vi.fn(),
    isDirty: false,
    isSaving: false,
    savedCount: 0,
    error: null,
    handleSubmit: vi.fn(),
  };
}

it.each(["de", "en"] as const)(
  "shows an explicit account prompt and saved subscription in %s",
  (language) => {
    const i18n = createI18n(language);
    const view = render(
      <I18nextProvider i18n={i18n}>
        <AgentZaiAccountField form={accountForm("zai")} />
      </I18nextProvider>,
    );
    expect(screen.getByRole("combobox").textContent).toContain(
      i18n.t("settings.agents.zaiChooseAccount"),
    );
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <AgentZaiAccountField form={accountForm("zai", "coding-plan")} />
      </I18nextProvider>,
    );
    expect(screen.getByRole("combobox").textContent).toContain(
      "GLM Coding Plan",
    );
    view.unmount();
  },
);

it("does not offer z.ai routing for other providers", () => {
  const view = render(
    <I18nextProvider i18n={createI18n("de")}>
      <AgentZaiAccountField form={accountForm("opencode")} />
    </I18nextProvider>,
  );
  expect(screen.queryByRole("combobox")).toBeNull();
  view.unmount();
});
