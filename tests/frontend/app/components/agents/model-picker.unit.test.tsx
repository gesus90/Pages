import { I18nextProvider } from "react-i18next";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { ModelPicker } from "@/app/components/agents/model-picker";
import { createI18n } from "@/app/lib/i18n";

import { pageModel } from "./plans/plan-model-fixture";

import type { PageAgentModel } from "@/definition/PageAgent";

const i18n = createI18n("en");

const OWN_MODEL = pageModel("own", {
  provider: "opencode",
  model: "opencode/big-pickle",
  modelName: "Big Pickle",
});
const FOREIGN_MODEL = pageModel("foreign", {
  provider: "opencode",
  model: "anthropic/sonnet",
  modelName: "Sonnet",
});

function renderPicker(value: string, models: readonly PageAgentModel[]): void {
  render(
    <I18nextProvider i18n={i18n}>
      <ModelPicker
        value={value}
        models={models}
        disabled={false}
        onChange={() => {}}
      />
    </I18nextProvider>,
  );
}

function triggerText(): string {
  return screen.getByRole("combobox").textContent;
}

it("names the source of an OpenCode model that comes from another provider", () => {
  renderPicker(FOREIGN_MODEL.id, [OWN_MODEL, FOREIGN_MODEL]);

  expect(triggerText()).toContain("Sonnet");
  expect(triggerText()).toContain("OpenCode · anthropic");
});

it("does not repeat the tool when a model's source is named like the tool", () => {
  renderPicker(OWN_MODEL.id, [OWN_MODEL, FOREIGN_MODEL]);

  expect(triggerText()).toContain("Big Pickle");
  expect(triggerText()).toContain("OpenCode");
  expect(triggerText()).not.toContain("OpenCode · OpenCode");
});
