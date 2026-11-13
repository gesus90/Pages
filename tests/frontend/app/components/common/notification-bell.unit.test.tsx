import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { NotificationBell } from "@/app/components/common/notification-bell";
import {
  showSuccessToast,
  showToast,
  Toaster,
  ToastProvider,
} from "@/app/components/ui/toast";
import { createI18n } from "@/app/lib/i18n";

it("retains only errors and chats in the actual bell and offers their action after closing the popup", async () => {
  const open = vi.fn();
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <ToastProvider>
        <NotificationBell />
        <Toaster />
      </ToastProvider>
    </I18nextProvider>,
  );
  act(() => {
    showSuccessToast("Saved");
    showToast({ type: "info", message: "Copied" });
    showToast({ type: "warning", message: "Unstable" });
    showToast({ type: "error", message: "Failed" });
    showToast({
      type: "chat",
      message: "All Might",
      description: "Hello",
      count: 2,
      chat: { kind: "participant", id: "agent" },
      action: { label: "Open", onClick: open },
    });
  });
  const chat = screen
    .getAllByRole("status")
    .find((entry) => entry.textContent?.includes("All Might"));
  if (!chat) throw new Error("Chat popup missing");
  fireEvent.click(
    within(chat).getByRole("button", { name: "Dismiss notification" }),
  );
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  });
  expect(screen.queryByText("All Might")).toBeNull();
  fireEvent.keyDown(screen.getByRole("button", { name: "Notifications (2)" }), {
    key: "ArrowDown",
  });
  const menu = await screen.findByRole("menu");
  expect(within(menu).getByText("Failed")).toBeTruthy();
  expect(within(menu).getByText("All Might")).toBeTruthy();
  expect(within(menu).queryByText("Saved")).toBeNull();
  expect(within(menu).queryByText("Copied")).toBeNull();
  expect(within(menu).queryByText("Unstable")).toBeNull();
  fireEvent.click(within(menu).getByRole("menuitem", { name: /All Might/ }));
  expect(open).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("button", { name: "Notifications (1)" }),
  ).toBeTruthy();
});
