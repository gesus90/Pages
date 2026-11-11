import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { AgentFormFields } from "@/app/components/settings/agents/agent-form-fields";
import { createI18n } from "@/app/lib/i18n";
import { GLOBAL_CONNECTION_SCOPE } from "@/definition/AgentConnectionScope";

import type { AgentForm } from "@/app/components/settings/agents/use-agent-form";

const i18n = createI18n("en");

function form(overrides: Partial<AgentForm> = {}): AgentForm {
  return {
    fields: {
      name: "Main",
      provider: "codex_cli",
      apiKey: "secret",
      testModel: "old",
      reasoningEffort: "high",
      scope: GLOBAL_CONNECTION_SCOPE,
      zaiAccountType: "",
    },
    setField: vi.fn(),
    isDirty: false,
    isSaving: false,
    savedCount: 0,
    error: null,
    handleSubmit: vi.fn(),
    ...overrides,
  };
}

function renderFields(current: AgentForm, isExisting: boolean): void {
  render(
    <I18nextProvider i18n={i18n}>
      <AgentFormFields
        form={current}
        kind="api_key"
        availability={{ isExisting, isUnlocked: true, isLoading: false }}
        directory={{ persons: [], groups: [], departments: [] }}
      />
    </I18nextProvider>,
  );
}

it("reveals a replacement key and toggles its visibility", () => {
  const current = form();
  renderFields(current, true);
  expect(screen.queryByLabelText(i18n.t("settings.agents.apiKey"))).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("settings.agents.replaceKey") }),
  );
  const key = screen.getByLabelText(i18n.t("settings.agents.apiKey"));
  expect(key.getAttribute("type")).toBe("password");
  fireEvent.change(key, { target: { value: "new-key" } });
  expect(current.setField).toHaveBeenCalledWith("apiKey", "new-key");
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("settings.agents.showKey") }),
  );
  expect(key.getAttribute("type")).toBe("text");
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("settings.agents.hideKey") }),
  );
  expect(key.getAttribute("type")).toBe("password");
});

it("marks a rejected key and associates the error", () => {
  const current = form({ error: "api_key_required" });
  renderFields(current, false);
  const key = screen.getByLabelText(i18n.t("settings.agents.apiKey"));
  expect(key.getAttribute("aria-invalid")).toBe("true");
  expect(key.getAttribute("aria-describedby")).toBe("agent-key-error");
});
