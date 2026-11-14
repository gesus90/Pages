import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { ChatDecisionCard } from "@/app/components/settings/agents/chat-decision-card";
import { createI18n } from "@/app/lib/i18n";
import { CONVERSATION_DEFAULT_DECISION_RULES } from "@/definition/ConversationDecision";

import type { ChatDecisionAdministration } from "@/definition/ConversationDecision";
import type { PageAgentModel } from "@/definition/PageAgent";

const fetcher = vi.hoisted((): { state: string; data: unknown } => ({
  state: "idle",
  data: undefined,
}));
vi.mock("react-router", () => ({
  useFetcher: () => ({
    state: fetcher.state,
    data: fetcher.data,
    Form: (props: React.ComponentProps<"form">) => <form {...props} />,
  }),
}));

const i18n = createI18n("en");

function decider(model: string, name: string): PageAgentModel {
  return {
    id: `openrouter:${model}`,
    connectionId: "openrouter",
    name: `${name} · OpenRouter`,
    modelName: name,
    connectionName: "OpenRouter",
    model,
    provider: "openrouter",
    reasoning: "none",
    reasoningEfforts: [],
    catalogDefaultReasoningEffort: null,
    reasoningEffort: null,
    isDecisionCapable: true,
  };
}

const ADMINISTRATION: ChatDecisionAdministration = {
  settings: {
    selection: {
      connectionId: "openrouter",
      model: "perplexity/pplx-decider-v1.3",
      reasoningEffort: null,
    },
    rules: CONVERSATION_DEFAULT_DECISION_RULES,
    revision: 3,
  },
  status: "ready",
  models: [
    decider("perplexity/pplx-decider-v1.3", "Perplexity Decider V1.3"),
    decider("perplexity/pplx-decider-flash-v1.3", "Decider Flash V1.3"),
  ],
};

function renderCard(
  administration: ChatDecisionAdministration = ADMINISTRATION,
): HTMLFormElement {
  const { container } = render(
    <I18nextProvider i18n={i18n}>
      <ChatDecisionCard administration={administration} />
    </I18nextProvider>,
  );
  const form = container.querySelector("form");
  if (form === null) throw new Error("form expected");
  return form;
}

function fields(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(
    [...new FormData(form).entries()].map(([name, value]) => [
      name,
      String(value),
    ]),
  );
}

it("submits the chosen decision model with the default thresholds and no reasoning level", () => {
  const form = renderCard();
  expect(fields(form)).toEqual({
    intent: "save-chat-decision",
    revision: "3",
    modelConnectionId: "openrouter",
    model: "perplexity/pplx-decider-v1.3",
    answerThreshold: "60",
    responsibilityThreshold: "50",
    secondThreshold: "40",
    maximumResponders: "2",
  });
  expect(screen.queryByText(/reasoning/i)).toBeNull();
  expect(screen.getByText("Ready")).toBeTruthy();
});

it("takes the thresholds the administrator sets as the defaults of the groups", () => {
  const form = renderCard();
  fireEvent.change(screen.getByRole("slider", { name: "Answer threshold" }), {
    target: { value: "75" },
  });
  fireEvent.change(screen.getByRole("slider", { name: "Second threshold" }), {
    target: { value: "30" },
  });
  fireEvent.change(
    screen.getByRole("slider", { name: "Most answering agents" }),
    { target: { value: "3" } },
  );
  expect(fields(form)).toMatchObject({
    answerThreshold: "75",
    responsibilityThreshold: "50",
    secondThreshold: "30",
    maximumResponders: "3",
  });
});

it("submits an empty model while none is chosen and says so", () => {
  const form = renderCard({
    ...ADMINISTRATION,
    settings: { ...ADMINISTRATION.settings, selection: null },
    status: "noModel",
  });
  expect(fields(form)).toMatchObject({ modelConnectionId: "", model: "" });
  expect(screen.getByText("No model chosen")).toBeTruthy();
  expect(
    screen.getByText(
      /Without a decision model only agents named with @ answer/,
    ),
  ).toBeTruthy();
});

it("keeps a saved model the catalog no longer lists until another is chosen", () => {
  const form = renderCard({
    ...ADMINISTRATION,
    settings: {
      ...ADMINISTRATION.settings,
      selection: {
        connectionId: "openrouter",
        model: "perplexity/gone",
        reasoningEffort: null,
      },
    },
    status: "modelUnavailable",
  });
  expect(fields(form)).toMatchObject({
    modelConnectionId: "openrouter",
    model: "perplexity/gone",
  });
  expect(screen.getByText("Model unavailable")).toBeTruthy();
});

it("confirms a saved choice and names a refused one", () => {
  fetcher.data = { ok: true, intent: "save-chat-decision" };
  const { unmount } = render(
    <I18nextProvider i18n={i18n}>
      <ChatDecisionCard administration={ADMINISTRATION} />
    </I18nextProvider>,
  );
  expect(screen.getByText("Decision model and defaults saved.")).toBeTruthy();
  unmount();
  fetcher.data = {
    ok: false,
    intent: "save-chat-decision",
    error: "provider_model_not_found",
  };
  render(
    <I18nextProvider i18n={i18n}>
      <ChatDecisionCard administration={ADMINISTRATION} />
    </I18nextProvider>,
  );
  expect(screen.getByRole("alert").textContent).toBe(
    "The chosen model is not available for decisions in chats.",
  );
  fetcher.data = undefined;
});
