import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { SpeechSettingsCard } from "@/app/components/settings/agents/speech-settings-card";
import { createI18n } from "@/app/lib/i18n";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type { SpeechAdministration } from "@/definition/SpeechRecognition";

const fetcher = vi.hoisted(
  (): {
    state: "idle" | "submitting";
    data: AgentActionResult | undefined;
    Form: (props: React.ComponentProps<"form">) => React.ReactElement;
  } => ({
    state: "idle",
    data: undefined,
    Form: (props) => <form {...props} />,
  }),
);
vi.mock("react-router", () => ({ useFetcher: () => fetcher }));

const i18n = createI18n("en");

function administration(
  overrides: Partial<SpeechAdministration> = {},
): SpeechAdministration {
  return {
    settings: {
      selection: { connectionId: "c1", model: "retired" },
      maxDurationMs: 120000,
      revision: 1,
    },
    status: "ready",
    models: [],
    modelLimits: {},
    effectiveMaxDurationMs: 120000,
    isSimulation: false,
    ...overrides,
  };
}

function card(settings: SpeechAdministration): React.ReactElement {
  return (
    <I18nextProvider i18n={i18n}>
      <SpeechSettingsCard administration={settings} />
    </I18nextProvider>
  );
}

function fields(): Record<string, FormDataEntryValue> {
  const form = document.querySelector("form");
  if (!form) throw new Error("Missing form");
  return Object.fromEntries(new FormData(form));
}

beforeEach(() => {
  fetcher.state = "idle";
  fetcher.data = undefined;
});

it("preserves a saved model absent from the catalog in the submitted form", () => {
  render(card(administration({ isSimulation: true })));
  expect(fields()).toEqual({
    intent: "save-speech",
    revision: "1",
    modelConnectionId: "c1",
    model: "retired",
    maxDurationMs: "120000",
  });
  expect(screen.getByText(i18n.t("speechSettings.simulation"))).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: i18n.t("speechSettings.testButton.idle") })
      .hasAttribute("disabled"),
  ).toBe(false);
});

it("disables actions while saving and shows only completed save feedback", () => {
  fetcher.state = "submitting";
  fetcher.data = { ok: true, intent: "save-speech" };
  const view = render(card(administration()));
  expect(
    screen
      .getByRole("button", { name: i18n.t("settings.agents.save") })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.queryByText(i18n.t("speechSettings.saved"))).toBeNull();
  fetcher.state = "idle";
  view.rerender(card(administration()));
  expect(screen.getByText(i18n.t("speechSettings.saved"))).toBeTruthy();
  fetcher.data = { ok: false, intent: "save-speech", error: "general" };
  view.rerender(card(administration()));
  expect(
    screen.getByText(i18n.t("settings.agents.error.general")),
  ).toBeTruthy();
});

it("prevents a test when no model is configured", () => {
  render(
    card(
      administration({
        status: "noModel",
        settings: { selection: null, revision: 2, maxDurationMs: 60000 },
      }),
    ),
  );
  expect(fields()).toMatchObject({
    modelConnectionId: "",
    model: "",
    revision: "2",
  });
  const button = screen.getByRole("button", {
    name: i18n.t("speechSettings.testButton.idle"),
  });
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.click(button);
});
