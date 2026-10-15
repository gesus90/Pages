import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { showSuccessToast, Toaster } from "@/app/components/ui/toast";
import { createI18n } from "@/app/lib/i18n";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function renderToaster(): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={createI18n("en")}>
      <Toaster />
    </I18nextProvider>,
  );
}

it("announces at most three recent messages and dismisses a chosen one", () => {
  renderToaster();
  act(() => {
    ["first", "second", "third", "fourth"].forEach(showSuccessToast);
  });
  expect(
    screen.getAllByRole("status").map((entry) => entry.textContent),
  ).toEqual(["second", "third", "fourth"]);
  fireEvent.click(within(screen.getAllByRole("status")[1]).getByRole("button"));
  expect(
    screen.getAllByRole("status").map((entry) => entry.textContent),
  ).toEqual(["second", "fourth"]);
});

it("dismisses after four seconds", () => {
  renderToaster();
  act(() => showSuccessToast("saved"));
  act(() => {
    vi.advanceTimersByTime(3999);
  });
  expect(screen.getByRole("status").textContent).toBe("saved");
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.queryByRole("status")).toBeNull();
});

it.each(["hover", "focus"])(
  "pauses during %s and resumes with the remaining time",
  (interaction) => {
    renderToaster();
    act(() => showSuccessToast("saved"));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    const toast = screen.getByRole("status");
    if (interaction === "hover") fireEvent.mouseEnter(toast);
    else fireEvent.focus(within(toast).getByRole("button"));
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByRole("status")).toBe(toast);
    if (interaction === "hover") fireEvent.mouseLeave(toast);
    else
      fireEvent.blur(within(toast).getByRole("button"), {
        relatedTarget: document.body,
      });
    act(() => {
      vi.advanceTimersByTime(2499);
    });
    expect(screen.getByRole("status")).toBe(toast);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("status")).toBeNull();
  },
);

it("ignores malformed events and cleans listeners and timers on unmount", () => {
  const { unmount } = renderToaster();
  act(() => {
    window.dispatchEvent(new Event("pages:success"));
    window.dispatchEvent(new CustomEvent("pages:success", { detail: 123 }));
  });
  expect(screen.queryByRole("status")).toBeNull();
  act(() => showSuccessToast("saved"));
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  act(() => showSuccessToast("after unmount"));
  expect(vi.getTimerCount()).toBe(0);
});
