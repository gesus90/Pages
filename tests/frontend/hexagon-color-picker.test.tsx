// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";

import { HexagonColorPicker } from "@/app/components/tasks/hexagon-color-picker";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

function renderPicker(color: string, onChange: (color: string) => void): void {
  const i18n = createI18n(LANGUAGE.GERMAN);

  render(
    <I18nextProvider i18n={i18n}>
      <HexagonColorPicker color={color} onChange={onChange} />
    </I18nextProvider>,
  );
}

function setRect(
  element: HTMLElement,
  rect: {
    readonly height: number;
    readonly left: number;
    readonly top: number;
    readonly width: number;
  },
): void {
  element.getBoundingClientRect = (): DOMRect => ({
    bottom: rect.top + rect.height,
    height: rect.height,
    left: rect.left,
    right: rect.left + rect.width,
    top: rect.top,
    width: rect.width,
    x: rect.left,
    y: rect.top,
    toJSON() {
      return {};
    },
  });
}

describe("HexagonColorPicker", () => {
  it("renders the saturation pad and hue slider", () => {
    renderPicker("#ff0000", vi.fn());

    expect(
      screen.getByRole("slider", { name: "Eigene Farbe" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Farbton" })).toBeInTheDocument();
  });

  it("updates the color when the saturation pad is clicked", () => {
    const onChange = vi.fn();
    renderPicker("#ff0000", onChange);

    const pad = screen.getByRole("slider", { name: "Eigene Farbe" });
    setRect(pad, { height: 100, left: 0, top: 0, width: 100 });

    fireEvent.pointerDown(pad, { clientX: 50, clientY: 50, pointerId: 1 });

    expect(onChange).toHaveBeenCalled();
  });

  it("updates the color when the hue slider is clicked", () => {
    const onChange = vi.fn();
    renderPicker("#ff0000", onChange);

    const slider = screen.getByRole("slider", { name: "Farbton" });
    setRect(slider, { height: 12, left: 0, top: 0, width: 100 });

    fireEvent.pointerDown(slider, { clientX: 50, clientY: 6, pointerId: 1 });

    expect(onChange).toHaveBeenCalled();
  });

  it("updates the color when the saturation pad is dragged", () => {
    const onChange = vi.fn();
    renderPicker("#ff0000", onChange);

    const pad = screen.getByRole("slider", { name: "Eigene Farbe" });
    setRect(pad, { height: 100, left: 0, top: 0, width: 100 });

    fireEvent.pointerMove(pad, { buttons: 1, clientX: 75, clientY: 25 });

    expect(onChange).toHaveBeenCalled();
  });

  it("updates the color when the hue slider is dragged", () => {
    const onChange = vi.fn();
    renderPicker("#ff0000", onChange);

    const slider = screen.getByRole("slider", { name: "Farbton" });
    setRect(slider, { height: 12, left: 0, top: 0, width: 100 });

    fireEvent.pointerMove(slider, { buttons: 1, clientX: 25, clientY: 6 });

    expect(onChange).toHaveBeenCalled();
  });

  it("handles keyboard arrows on the saturation pad", () => {
    const onChange = vi.fn();
    renderPicker("#808080", onChange);

    const pad = screen.getByRole("slider", { name: "Eigene Farbe" });
    setRect(pad, { height: 100, left: 0, top: 0, width: 100 });

    fireEvent.keyDown(pad, { key: "ArrowRight" });
    fireEvent.keyDown(pad, { key: "ArrowUp" });
    fireEvent.keyDown(pad, { key: "ArrowLeft" });
    fireEvent.keyDown(pad, { key: "ArrowDown" });

    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("uses the larger step on the saturation pad when shift is held", () => {
    const onChange = vi.fn();
    renderPicker("#808080", onChange);

    const pad = screen.getByRole("slider", { name: "Eigene Farbe" });
    setRect(pad, { height: 100, left: 0, top: 0, width: 100 });

    fireEvent.keyDown(pad, { key: "ArrowRight", shiftKey: true });

    expect(onChange).toHaveBeenCalled();
  });

  it("ignores unrelated keys on the saturation pad", () => {
    const onChange = vi.fn();
    renderPicker("#808080", onChange);

    const pad = screen.getByRole("slider", { name: "Eigene Farbe" });

    fireEvent.keyDown(pad, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("handles keyboard arrows on the hue slider", () => {
    const onChange = vi.fn();
    renderPicker("#ff0000", onChange);

    const slider = screen.getByRole("slider", { name: "Farbton" });
    setRect(slider, { height: 12, left: 0, top: 0, width: 100 });

    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "ArrowUp" });

    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("uses the larger step on the hue slider when shift is held", () => {
    const onChange = vi.fn();
    renderPicker("#ff0000", onChange);

    const slider = screen.getByRole("slider", { name: "Farbton" });

    fireEvent.keyDown(slider, { key: "ArrowRight", shiftKey: true });

    expect(onChange).toHaveBeenCalled();
  });

  it("ignores unrelated keys on the hue slider", () => {
    const onChange = vi.fn();
    renderPicker("#ff0000", onChange);

    const slider = screen.getByRole("slider", { name: "Farbton" });

    fireEvent.keyDown(slider, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores pointer move on the saturation pad without button pressed", () => {
    const onChange = vi.fn();
    renderPicker("#ff0000", onChange);

    const pad = screen.getByRole("slider", { name: "Eigene Farbe" });
    setRect(pad, { height: 100, left: 0, top: 0, width: 100 });

    fireEvent.pointerMove(pad, { buttons: 0, clientX: 75, clientY: 25 });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores pointer move on the hue slider without button pressed", () => {
    const onChange = vi.fn();
    renderPicker("#ff0000", onChange);

    const slider = screen.getByRole("slider", { name: "Farbton" });
    setRect(slider, { height: 12, left: 0, top: 0, width: 100 });

    fireEvent.pointerMove(slider, { buttons: 0, clientX: 25, clientY: 6 });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("updates the color when a valid hex is typed into the input", () => {
    const onChange = vi.fn();
    renderPicker("#ff0000", onChange);

    const input = screen.getByLabelText("HEX");

    fireEvent.change(input, { target: { value: "#00ff00" } });

    expect(onChange).toHaveBeenCalledWith("#00ff00");
  });

  it("does not call onChange when an invalid hex is typed", () => {
    const onChange = vi.fn();
    renderPicker("#ff0000", onChange);

    const input = screen.getByLabelText("HEX");

    fireEvent.change(input, { target: { value: "not-a-color" } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("reflects external color changes while preserving an invalid draft", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
        <HexagonColorPicker color="#ff0000" onChange={onChange} />
      </I18nextProvider>,
    );

    const input = screen.getByLabelText("HEX");

    fireEvent.change(input, { target: { value: "not-a-color" } });

    rerender(
      <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
        <HexagonColorPicker color="#00ff00" onChange={onChange} />
      </I18nextProvider>,
    );

    expect(input).toHaveValue("not-a-color");
  });

  it("updates the hex draft when the external color changes to a new valid value", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
        <HexagonColorPicker color="#ff0000" onChange={onChange} />
      </I18nextProvider>,
    );

    rerender(
      <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
        <HexagonColorPicker color="#00ff00" onChange={onChange} />
      </I18nextProvider>,
    );

    const input = screen.getByLabelText("HEX");

    expect(input).toHaveValue("#00FF00");
  });
});
