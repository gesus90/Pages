// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyField } from "@/app/components/projects/integration-fields";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

function renderField(): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
      <CopyField id="webhook" value="https://pages.example.com/hook" />
    </I18nextProvider>,
  );
}

function setClipboard(clipboard: unknown): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });
}

describe("CopyField", () => {
  afterEach(() => {
    vi.useRealTimers();
    setClipboard(undefined);
  });

  it("shows the value read-only", () => {
    renderField();

    expect(
      screen.getByDisplayValue("https://pages.example.com/hook"),
    ).toHaveAttribute("readonly");
  });

  it("does nothing when the browser has no clipboard", () => {
    setClipboard(undefined);
    const { container } = renderField();

    fireEvent.click(
      screen.getByRole("button", { name: "Webhook-URL kopieren" }),
    );

    expect(container.querySelector(".lucide-check")).toBeNull();
  });

  it("copies the value and resets the confirmation after two seconds", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);

    setClipboard({ writeText });

    const { container } = renderField();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Webhook-URL kopieren" }),
      );
    });

    expect(writeText).toHaveBeenCalledWith("https://pages.example.com/hook");
    expect(container.querySelector(".lucide-check")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1999);
    });

    expect(container.querySelector(".lucide-check")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(container.querySelector(".lucide-check")).toBeNull();
    expect(container.querySelector(".lucide-copy")).not.toBeNull();
  });

  it("stays quiet when the clipboard refuses the write", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    const { container } = renderField();

    await act(async () => {
      await userEvent.click(
        screen.getByRole("button", { name: "Webhook-URL kopieren" }),
      );
    });

    expect(container.querySelector(".lucide-check")).toBeNull();
  });

  it("clears a pending reset when it unmounts", async () => {
    vi.useFakeTimers();
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    const clear = vi.spyOn(window, "clearTimeout");
    const { container, unmount } = renderField();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Webhook-URL kopieren" }),
      );
    });

    expect(container.querySelector(".lucide-check")).not.toBeNull();

    clear.mockClear();
    unmount();

    expect(clear).toHaveBeenCalledTimes(1);
  });
});
