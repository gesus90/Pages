import { I18nextProvider } from "react-i18next";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  ModelFieldRow,
  ReasoningField,
} from "@/app/components/agents/model-picker/model-field";
import { createI18n } from "@/app/lib/i18n";

import type { ReasoningSelectOptions } from "@/app/lib/reasoning-options";

const i18n = createI18n("en");

const OPTIONS: ReasoningSelectOptions = [
  { value: "", label: "Default" },
  { value: "high", label: "high" },
];

function renderField(
  props: Partial<Parameters<typeof ReasoningField>[0]> = {},
): void {
  render(
    <I18nextProvider i18n={i18n}>
      <ReasoningField
        value="high"
        options={OPTIONS}
        disabled={false}
        onChange={vi.fn()}
        {...props}
      />
    </I18nextProvider>,
  );
}

it("labels the reasoning select and shows the visible label", () => {
  renderField();

  const select = screen.getByRole("combobox", { name: "Reasoning" });
  expect(select.textContent).toContain("high");
  expect(select.hasAttribute("disabled")).toBe(false);
  expect(screen.getByText("Reasoning", { selector: "label" }).className).toBe(
    "mb-1.5 block text-sm leading-5 font-medium text-foreground",
  );
});

it("keeps the label for assistive technology only when it is hidden", () => {
  renderField({ isLabelHidden: true });

  expect(screen.getByText("Reasoning", { selector: "label" }).className).toBe(
    "sr-only",
  );
});

it("shows the note below the field only when there is one", () => {
  renderField({ note: "This model has no levels." });
  expect(screen.getByText("This model has no levels.")).toBeTruthy();
});

it("shows no note for an empty or missing note", () => {
  renderField({ note: null });
  expect(document.querySelector("p")).toBeNull();
});

it("disables the select when told so", () => {
  renderField({ disabled: true });
  expect(
    screen
      .getByRole("combobox", { name: "Reasoning" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

it("disables the select for a single option", () => {
  renderField({ options: [{ value: "", label: "Default" }], value: "" });
  expect(
    screen
      .getByRole("combobox", { name: "Reasoning" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

it("lays its children out in two columns", () => {
  render(
    <ModelFieldRow>
      <span>left</span>
      <span>right</span>
    </ModelFieldRow>,
  );

  const row = screen.getByText("left").parentElement;
  expect(row?.className).toContain("grid-cols-2");
  expect(row?.children).toHaveLength(2);
});

it("disables reasoning when only sibling models support the listed levels", () => {
  renderField({
    options: [
      { value: "", label: "Default" },
      { value: "high", label: "high", disabled: true },
    ],
    value: "",
  });
  expect(
    screen
      .getByRole("combobox", { name: "Reasoning" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
