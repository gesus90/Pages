import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  showSuccessToast,
  showToast,
  Toaster,
  ToastProvider,
} from "@/app/components/ui/toast";
import { useToastCenter } from "@/app/components/ui/toast/toast-provider";
import { createI18n } from "@/app/lib/i18n";

import type { ToastInput } from "@/app/components/ui/toast";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function InboxProbe(): React.ReactElement {
  const { inbox, dispatch } = useToastCenter();
  return (
    <>
      <div aria-label="bell">
        {inbox.map((entry) => `${entry.type}:${entry.message}`).join(",")}
      </div>
      <button
        onClick={() =>
          dispatch({ type: "open-chat", key: "participant:all-might" })
        }
      >
        Select chat
      </button>
    </>
  );
}

function renderToaster(
  language: "en" | "de" = "en",
): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={createI18n(language)}>
      <ToastProvider>
        <InboxProbe />
        <Toaster />
      </ToastProvider>
    </I18nextProvider>,
  );
}

function advance(milliseconds: number): void {
  act(() => {
    vi.advanceTimersByTime(milliseconds);
  });
}

function chatNotice(
  overrides: Partial<Extract<ToastInput, { type: "chat" }>> = {},
): ToastInput {
  return {
    type: "chat",
    message: "All Might",
    description: "Look here",
    count: 1,
    chat: { kind: "participant", id: "all-might" },
    ...overrides,
  };
}

it("places three newest cards at the requested responsive position and evicts the oldest", () => {
  const { container } = renderToaster();
  act(() => ["first", "second", "third", "fourth"].forEach(showSuccessToast));
  expect(screen.queryByText("first")).toBeNull();
  expect(
    screen.getAllByRole("status").map((entry) => entry.textContent),
  ).toEqual(["fourth", "third", "second"]);
  const position = container.querySelector(".fixed");
  expect(position?.className).toContain("inset-x-2 top-23");
  expect(position?.className).toContain("sm:right-5 sm:w-88");
  expect(position?.className).toContain("gap-2");
  fireEvent.click(within(screen.getAllByRole("status")[1]).getByRole("button"));
  advance(220);
  expect(
    screen.getAllByRole("status").map((entry) => entry.textContent),
  ).toEqual(["fourth", "second"]);
});

it.each([
  ["success", 4000, "check-circle"],
  ["info", 6000, "info"],
  ["warning", 8000, "triangle-alert"],
] as const)(
  "renders %s with its symbol and expires after %i ms plus exit animation",
  (type, duration, symbol) => {
    renderToaster();
    act(() =>
      showToast({ type, message: type, description: "Additional detail" }),
    );
    const toast = screen.getByRole("status");
    expect(toast.getAttribute("aria-live")).toBe("polite");
    expect(toast.querySelector("svg")?.classList.toString()).toContain(symbol);
    expect(screen.getByText("Additional detail").className).toContain(
      "truncate",
    );
    advance(duration - 1);
    expect(screen.getByRole("status")).toBe(toast);
    advance(1);
    expect(toast.className).toContain("leaving");
    advance(220);
    expect(screen.queryByText(type)).toBeNull();
    expect(screen.getByLabelText("bell").textContent).toBe("");
  },
);

it("keeps errors assertive until explicitly dismissed, retains them in the bell, and runs actions", () => {
  renderToaster("de");
  const retry = vi.fn();
  act(() =>
    showToast({
      type: "error",
      message: "Speichern fehlgeschlagen",
      action: { label: "Erneut versuchen", onClick: retry },
    }),
  );
  expect(screen.getByRole("alert").getAttribute("aria-live")).toBe("assertive");
  expect(
    screen.getByRole("alert").querySelector("svg")?.classList.toString(),
  ).toContain("circle-x");
  expect(
    screen.getByRole("button", { name: "Meldung schließen" }),
  ).toBeTruthy();
  advance(120_000);
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByLabelText("bell").textContent).toContain(
    "error:Speichern fehlgeschlagen",
  );
});

it.each(["hover", "focus"])(
  "pauses during %s and resumes with the remaining time",
  (interaction) => {
    renderToaster();
    act(() => showSuccessToast("saved"));
    advance(1500);
    const toast = screen.getByRole("status");
    const close = within(toast).getByRole("button");
    if (interaction === "hover") fireEvent.mouseEnter(toast);
    else fireEvent.focus(close);
    advance(10_000);
    expect(screen.getByRole("status")).toBe(toast);
    if (interaction === "hover") fireEvent.mouseLeave(toast);
    else fireEvent.blur(close, { relatedTarget: document.body });
    advance(2499);
    expect(toast.className).not.toContain("leaving");
    advance(1);
    expect(toast.className).toContain("leaving");
    advance(220);
    expect(screen.queryByText("saved")).toBeNull();
  },
);

it("keeps pausing when hover and focus overlap or focus moves between the action and close", () => {
  renderToaster();
  act(() =>
    showToast({
      type: "info",
      message: "copy",
      action: { label: "Undo", onClick: vi.fn() },
    }),
  );
  const toast = screen.getByRole("status");
  const action = within(toast).getByRole("button", { name: "Undo" });
  const close = within(toast).getByRole("button", {
    name: "Dismiss notification",
  });
  fireEvent.mouseEnter(toast);
  fireEvent.focus(action);
  fireEvent.mouseLeave(toast);
  fireEvent.blur(action, { relatedTarget: close });
  fireEvent.focus(close);
  advance(10_000);
  expect(toast.className).not.toContain("leaving");
  fireEvent.keyDown(close, { key: "Escape" });
  advance(220);
  expect(screen.queryByText("copy")).toBeNull();
});

it("deduplicates in place, restarts the lifetime even while paused, and revives an exiting card", () => {
  renderToaster();
  act(() => showSuccessToast("saved"));
  const original = screen.getByRole("status");
  advance(3000);
  act(() => showToast({ type: "info", message: "newer" }));
  fireEvent.mouseEnter(original);
  act(() => showSuccessToast("saved"));
  advance(5000);
  expect(screen.getAllByRole("status")).toHaveLength(2);
  fireEvent.mouseLeave(original);
  advance(3999);
  expect(original.className).not.toContain("leaving");
  advance(1);
  expect(original.className).toContain("leaving");
  act(() => showSuccessToast("saved"));
  expect(original.className).not.toContain("leaving");
  advance(4000);
  advance(220);
  expect(screen.queryByText("saved")).toBeNull();
});

it("merges each chat in place with its latest preview, resets eight seconds and opens it", () => {
  renderToaster();
  const open = vi.fn();
  act(() =>
    showToast(chatNotice({ action: { label: "Open", onClick: open } })),
  );
  const original = screen.getByRole("status");
  expect(original.querySelector("span[aria-hidden]")?.className).toContain(
    "size-8",
  );
  advance(7000);
  act(() => {
    showToast(
      chatNotice({ chat: { kind: "group", id: "other" }, message: "Team" }),
    );
    showToast(
      chatNotice({
        count: 2,
        description: "Latest message",
        action: { label: "Open", onClick: open },
      }),
    );
  });
  expect(screen.getAllByRole("status")[1]).toBe(original);
  expect(within(original).getByText("3 new")).toBeTruthy();
  expect(within(original).getByText("Latest message")).toBeTruthy();
  advance(7999);
  expect(original.className).not.toContain("leaving");
  fireEvent.click(within(original).getByRole("button", { name: "Open" }));
  expect(open).toHaveBeenCalledOnce();
  expect(screen.queryByText("All Might")).toBeNull();
  expect(screen.getByLabelText("bell").textContent).toContain("chat:All Might");
  advance(1);
  advance(220);
  expect(screen.queryByText("Team")).toBeNull();
});

it("suppresses the opened chat, also dismisses a card when its chat opens, but still records the bell", () => {
  renderToaster();
  act(() => showToast(chatNotice()));
  fireEvent.click(screen.getByRole("button", { name: "Select chat" }));
  expect(screen.queryByText("All Might")).toBeNull();
  act(() => showToast(chatNotice()));
  expect(screen.queryByText("All Might")).toBeNull();
  expect(screen.getByLabelText("bell").textContent).toBe("chat:All Might");
});

it("ignores malformed events and cleans document listeners and timers on unmount", () => {
  const { unmount } = renderToaster();
  act(() => {
    window.dispatchEvent(
      new CustomEvent("pages:toast", {
        detail: {
          type: { toString: () => "success" },
          message: "malformed",
        },
      }),
    );
    window.dispatchEvent(new Event("pages:success"));
    window.dispatchEvent(new CustomEvent("pages:success", { detail: 123 }));
    window.dispatchEvent(
      new CustomEvent("pages:toast", {
        detail: { type: "chat", message: "bad", count: -1 },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("pages:toast", {
        detail: { type: "error", message: "bad", action: {} },
      }),
    );
  });
  expect(screen.queryAllByRole("status")).toHaveLength(0);
  act(() => showSuccessToast("saved"));
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  act(() => showSuccessToast("after unmount"));
  expect(vi.getTimerCount()).toBe(0);
});
