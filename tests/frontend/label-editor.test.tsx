// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";

import { LabelEditor } from "@/app/components/tasks/label-editor";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

function renderEditor(
  overrides: Partial<{
    name: string;
    color: string;
    isSaving: boolean;
    canSave: boolean;
    saveLabel: string;
    onNameChange: (name: string) => void;
    onColorChange: (color: string) => void;
    onSave: () => void;
    onCancel: () => void;
  }> = {},
): {
  readonly onNameChange: ReturnType<typeof vi.fn>;
  readonly onColorChange: ReturnType<typeof vi.fn>;
  readonly onSave: ReturnType<typeof vi.fn>;
  readonly onCancel: ReturnType<typeof vi.fn>;
} {
  const onNameChange = vi.fn();
  const onColorChange = vi.fn();
  const onSave = vi.fn();
  const onCancel = vi.fn();

  const i18n = createI18n(LANGUAGE.GERMAN);

  render(
    <I18nextProvider i18n={i18n}>
      <LabelEditor
        canSave={true}
        color="#f97316"
        name=""
        saveLabel="Speichern"
        onCancel={onCancel}
        onColorChange={onColorChange}
        onNameChange={onNameChange}
        onSave={onSave}
        {...overrides}
      />
    </I18nextProvider>,
  );

  return { onNameChange, onColorChange, onSave, onCancel };
}

describe("LabelEditor", () => {
  it("renders the name input, presets, and preview", () => {
    renderEditor({ color: "#f97316", name: "Bug" });

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: "Farbe" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Vorschau")).toBeInTheDocument();
    expect(screen.getByText("Bug")).toBeInTheDocument();
  });

  it("shows the placeholder when no name is provided", () => {
    renderEditor({ color: "#f97316", name: "" });

    expect(screen.getByText("z. B. API")).toBeInTheDocument();
  });

  it("shows the current color marker when the color is not a preset", () => {
    renderEditor({ color: "#112233", name: "Bug" });

    expect(screen.getByTitle("Aktuelle Farbe: #112233")).toBeInTheDocument();
  });

  it("triggers onNameChange when the input changes", () => {
    const user = userEvent.setup();
    const { onNameChange } = renderEditor();

    const input = screen.getByLabelText("Name");

    fireEvent.change(input, { target: { value: "Bug" } });

    expect(onNameChange).toHaveBeenCalledWith("Bug");
    void user;
  });

  it("submits when the user presses Enter with a savable name", () => {
    const { onSave } = renderEditor({
      canSave: true,
      name: "Bug",
    });

    const input = screen.getByLabelText("Name");

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSave).toHaveBeenCalled();
  });

  it("does not submit when the user presses Enter while saving is in progress", () => {
    const { onSave } = renderEditor({
      canSave: true,
      isSaving: true,
      name: "Bug",
    });

    const input = screen.getByLabelText("Name");

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not submit when the user presses Enter without a savable name", () => {
    const { onSave } = renderEditor({
      canSave: false,
      name: "",
    });

    const input = screen.getByLabelText("Name");

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSave).not.toHaveBeenCalled();
  });

  it("updates the color when a preset is clicked", () => {
    const { onColorChange } = renderEditor();

    const preset = screen.getByRole("button", { name: "#ef4444" });

    fireEvent.click(preset);

    expect(onColorChange).toHaveBeenCalledWith("#ef4444");
  });

  it("opens the custom color picker when the custom-color button is clicked", () => {
    renderEditor();

    const toggle = screen.getByRole("button", { name: "Eigene Farbe" });

    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("closes the custom color picker when the button is clicked twice", () => {
    renderEditor();

    const toggle = screen.getByRole("button", { name: "Eigene Farbe" });

    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("updates the color when the custom picker emits a new color", () => {
    const { onColorChange } = renderEditor();

    const toggle = screen.getByRole("button", { name: "Eigene Farbe" });

    fireEvent.click(toggle);

    const pad = screen.getByRole("slider", { name: "Eigene Farbe" });

    pad.getBoundingClientRect = (): DOMRect => ({
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    });

    fireEvent.pointerDown(pad, { clientX: 50, clientY: 50, pointerId: 1 });

    expect(onColorChange).toHaveBeenCalled();
  });

  it("triggers onSave when the save button is clicked", () => {
    const { onSave } = renderEditor({ canSave: true, name: "Bug" });

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(onSave).toHaveBeenCalled();
  });

  it("triggers onCancel when the cancel button is clicked", () => {
    const { onCancel } = renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(onCancel).toHaveBeenCalled();
  });

  it("disables the save button while saving is in progress", () => {
    renderEditor({ canSave: true, isSaving: true, name: "Bug" });

    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
  });

  it("disables the save button when canSave is false", () => {
    renderEditor({ canSave: false, name: "Bug" });

    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
  });

  it("renders the white check icon on dark preset colors", () => {
    renderEditor({ color: "#ef4444", name: "Bug" });

    const check = screen.getByRole("button", { name: "#ef4444" });

    const icon = check.querySelector("svg");

    expect(
      icon?.className.baseVal ?? icon?.getAttribute("class") ?? "",
    ).toContain("text-white");
  });

  it("renders the dark check icon on light preset colors", () => {
    renderEditor({ color: "#eab308", name: "Bug" });

    const check = screen.getByRole("button", { name: "#eab308" });

    const icon = check.querySelector("svg");

    expect(
      icon?.className.baseVal ?? icon?.getAttribute("class") ?? "",
    ).toContain("text-[#44403c]");
  });

  it("normalizes an invalid color to the default before previewing", () => {
    renderEditor({ color: "#112233", name: "Bug" });

    const swatch = screen.getByTitle("Aktuelle Farbe: #112233");

    expect(swatch).toBeInTheDocument();
  });

  it("falls back to the default color when the input is not a hex code", () => {
    renderEditor({ color: "not-a-color", name: "Bug" });

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });
});
