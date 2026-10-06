// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster, showSuccessToast } from "@/app/components/ui/toast";
import { createI18n } from "@/app/lib/i18n";

describe("document toaster", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderToaster(): ReturnType<typeof render> {
    return render(
      <I18nextProvider i18n={createI18n("de")}>
        <Toaster />
      </I18nextProvider>,
    );
  }

  it("announces at most three notices and dismisses each after four unpaused seconds", () => {
    renderToaster();
    act(() => {
      for (const text of ["First", "Second", "Third", "Fourth"])
        showSuccessToast(text);
    });
    expect(screen.queryByText("First")).not.toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(3);
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(screen.getAllByRole("status")).toHaveLength(3);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("pauses dismissal on hover and keyboard focus without taking the focus", () => {
    renderToaster();
    act(() => {
      showSuccessToast("Saved");
    });
    const toast = screen.getByRole("status");
    const close = screen.getByRole("button", { name: "Schließen" });
    expect(close).not.toHaveFocus();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.mouseEnter(toast);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(toast).toBeInTheDocument();
    fireEvent.focus(close);
    fireEvent.mouseLeave(toast);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(toast).toBeInTheDocument();
    fireEvent.blur(close, { relatedTarget: close });
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(toast).toBeInTheDocument();
    fireEvent.blur(close);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("supports explicit dismissal and ignores invalid events", () => {
    const view = renderToaster();
    act(() => {
      window.dispatchEvent(new Event("pages:success"));
      window.dispatchEvent(new CustomEvent("pages:success", { detail: null }));
      showSuccessToast("Saved");
    });
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    view.unmount();
    act(() => {
      showSuccessToast("After unmount");
    });
    expect(screen.queryByText("After unmount")).not.toBeInTheDocument();
  });
});
