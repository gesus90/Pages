import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { ChatDecisionCard } from "@/app/components/settings/agents/chat-decision-card";
import { createI18n } from "@/app/lib/i18n";
import { agentModelKey } from "@/definition/AgentPlanConfiguration";
import { modelGroups } from "@/app/components/agents/model-picker/model-catalog";
import { CONVERSATION_DEFAULT_DECISION_RULES } from "@/definition/ConversationDecision";

import { pageModel } from "../../agents/plans/plan-model-fixture";

const fetcher = vi.hoisted(() => ({
  state: "idle",
  data: undefined,
  Form: (props: React.ComponentProps<"form">) => <form {...props} />,
}));
vi.mock("react-router", () => ({ useFetcher: () => fetcher }));
const i18n = createI18n("en");
const text = pageModel(agentModelKey("api", "text"), {
  connectionId: "api",
  model: "text",
  modelName: "Text Model",
  provider: "openrouter",
  isDecisionCapable: true,
  isToolCapable: false,
  isChatCapable: false,
  isTextCapable: true,
});

it("groups the supplied model with its provider and keeps it selectable", () => {
  const groups = modelGroups([text], { translate: i18n.t });
  expect(groups).toHaveLength(1);
  expect(groups[0]?.sources[0]?.choices[0]).toMatchObject({
    model: text,
    refusal: null,
  });
});

it("submits the selected decision model through the real picker", () => {
  Element.prototype.scrollTo = vi.fn();
  const { container } = render(
    <I18nextProvider i18n={i18n}>
      <ChatDecisionCard
        administration={{
          settings: {
            selection: null,
            rules: CONVERSATION_DEFAULT_DECISION_RULES,
            revision: 4,
          },
          status: "noModel",
          models: [text],
        }}
      />
    </I18nextProvider>,
  );
  fireEvent.click(screen.getByRole("combobox", { name: /^Decision model/u }));
  const search = screen.getByRole("combobox", {
    name: "Search model or provider",
  });
  fireEvent.change(search, { target: { value: "Text Model" } });
  fireEvent.keyDown(search, { key: "Enter" });
  const form = container.querySelector("form");
  if (!form) throw new Error("Missing settings form");
  const submitted = new FormData(form);
  expect(submitted.get("modelConnectionId")).toBe("api");
  expect(submitted.get("model")).toBe("text");
  expect(submitted.get("revision")).toBe("4");
});

it("shows ready for the saved model and recovery instructions for an empty catalog", () => {
  const { unmount } = render(
    <I18nextProvider i18n={i18n}>
      <ChatDecisionCard
        administration={{
          settings: {
            selection: {
              connectionId: "api",
              model: "text",
              reasoningEffort: null,
            },
            revision: 5,
            rules: CONVERSATION_DEFAULT_DECISION_RULES,
          },
          status: "ready",
          models: [text],
        }}
      />
    </I18nextProvider>,
  );
  expect(
    screen.getByText(i18n.t("chatDecision.status.ready")).getAttribute("role"),
  ).toBe("status");
  unmount();
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <ChatDecisionCard
        administration={{
          settings: {
            selection: null,
            rules: CONVERSATION_DEFAULT_DECISION_RULES,
            revision: 6,
          },
          status: "noModel",
          models: [],
          emptyReason: "noTextModels",
        }}
      />
    </I18nextProvider>,
  );
  expect(screen.getByRole("note").textContent).toContain(
    "OpenRouter-Anbindung einrichten",
  );
});
