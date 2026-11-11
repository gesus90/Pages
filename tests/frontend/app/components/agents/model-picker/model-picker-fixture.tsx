import { I18nextProvider } from "react-i18next";
import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { ModelPicker } from "@/app/components/agents/model-picker";
import { createI18n } from "@/app/lib/i18n";

import { pageModel } from "../plans/plan-model-fixture";

import type { ModelPickerMode } from "@/app/components/agents/model-picker/use-model-picker";
import type { PageAgentModel } from "@/definition/PageAgent";

const i18n = createI18n("en");

export const SONNET = pageModel("sonnet", {
  provider: "claude_code",
  modelName: "Sonnet",
});
export const HAIKU = pageModel("haiku", {
  provider: "claude_code",
  modelName: "Haiku",
});
export const GPT = pageModel("gpt", {
  provider: "codex_cli",
  modelName: "GPT",
  isFree: true,
});
export const MODELS = [SONNET, HAIKU, GPT];

/** Props of the picker a test changes. */
export interface PickerOptions {
  readonly value?: string;
  readonly models?: readonly PageAgentModel[];
  readonly disabled?: boolean;
  readonly mode?: ModelPickerMode;
  readonly onChange?: (id: string) => void;
  readonly placeholder?: string;
  readonly savedModel?: string;
  readonly emptyLabel?: string;
  readonly isCatalogFailed?: boolean;
}

/** The picker element for a rerender with other props. */
export function pickerElement(options: PickerOptions): React.ReactElement {
  return (
    <I18nextProvider i18n={i18n}>
      <ModelPicker
        value={options.value ?? "sonnet"}
        models={options.models ?? MODELS}
        disabled={options.disabled ?? false}
        mode={options.mode}
        onChange={options.onChange ?? vi.fn()}
        placeholder={options.placeholder}
        savedModel={options.savedModel}
        emptyLabel={options.emptyLabel}
        isCatalogFailed={options.isCatalogFailed}
        refusalOf={(model) =>
          model.id === "haiku" ? "Needs a larger plan" : null
        }
      />
    </I18nextProvider>
  );
}

/** Renders the picker with the shared models; options override single props. */
export function renderPicker(
  options: PickerOptions = {},
): ReturnType<typeof render> {
  return render(pickerElement(options));
}

/** The picker's trigger button. */
export function trigger(): HTMLElement {
  return screen.getByRole("combobox", { name: /^Model/u });
}

/** The search field of the open panel. */
export function search(): HTMLInputElement {
  const field = screen.getByRole("combobox", {
    name: "Search model or provider",
  });
  if (!(field instanceof HTMLInputElement)) throw new Error("no search field");
  return field;
}

/** Opens the panel by a click on the trigger. */
export function open(): void {
  fireEvent.click(trigger());
}

/** The tree row of a tool whose name matches. */
export function groupRow(name: RegExp): HTMLElement {
  return screen.getByRole("treeitem", { name });
}

/** The accessible name of the row the search field points at, if any. */
export function activeRowName(): string | null {
  const id = search().getAttribute("aria-activedescendant");
  return id === null
    ? null
    : (document.getElementById(id)?.getAttribute("aria-label") ?? null);
}

/** Presses a key in the search field; `false` when the key's default was prevented. */
export function press(key: string): boolean {
  return fireEvent.keyDown(search(), { key });
}
