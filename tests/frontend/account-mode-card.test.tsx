// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useActionData,
} from "react-router";
import { describe, expect, it, vi } from "vitest";

import { AccountModeCard } from "@/app/components/settings/account-mode-card";
import { Toaster } from "@/app/components/ui/toast";
import { createI18n } from "@/app/lib/i18n";
import { createAccess } from "../helpers/authorization";

import type { AccountAccess } from "@/definition/Authorization";
import type { SettingsActionData } from "@/app/lib/settings-actions/settings-action-support.server";

vi.mock("react-router", async (original) => ({
  ...(await original<typeof import("react-router")>()),
  useActionData: vi.fn(),
}));

function renderMode(
  account: AccountAccess,
  action?: () => Promise<null>,
): {
  update: (
    result: SettingsActionData | undefined,
    next?: AccountAccess,
  ) => void;
} {
  let refresh: (next: AccountAccess) => void = () => {};
  function Harness(): React.ReactElement {
    const [current, setCurrent] = useState(account);
    refresh = setCurrent;
    return (
      <>
        <AccountModeCard account={current} />
        <Toaster />
      </>
    );
  }
  const router = createMemoryRouter([
    { path: "/", element: <Harness />, action },
  ]);
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
  return {
    update(result, next = account): void {
      act(() => {
        vi.mocked(useActionData).mockReturnValue(result);
        refresh({ ...next });
      });
    },
  };
}

describe("account mode card", () => {
  it("keeps ordinary users in their role and requires an assigned role before leaving admin mode", () => {
    const view = renderMode(createAccess());
    expect(
      screen.getByText("Rollenmodus", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    view.update(
      undefined,
      createAccess({ isAdmin: true, mode: "admin", role: null }),
    );
    expect(
      screen.getByRole("button", { name: "Zum Rollenmodus wechseln" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "Weisen Sie Ihrem Konto zuerst eine normale Rolle in der Benutzerverwaltung zu.",
      ),
    ).toBeInTheDocument();
    view.update(undefined, createAccess({ isAdmin: true, mode: "role" }));
    expect(
      screen.getByRole("button", { name: "Zum Admin-Modus wechseln" }),
    ).toBeEnabled();
  });

  it("keeps failures inline and announces a new successful switch once", () => {
    const account = createAccess({ isAdmin: true });
    const view = renderMode(account);
    view.update({ intent: "set-mode", ok: false });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    view.update(
      { intent: "set-mode", ok: true },
      { ...account, mode: "admin" },
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Gespeichert");
    view.update(undefined);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("disables repeated switch requests while the action is pending", async () => {
    const user = userEvent.setup();
    let resolve: () => void = () => {};
    const operation = new Promise<null>((finish) => {
      resolve = () => finish(null);
    });
    renderMode(createAccess({ isAdmin: true }), () => operation);
    await user.click(
      screen.getByRole("button", { name: "Zum Admin-Modus wechseln" }),
    );
    expect(
      screen.getByRole("button", { name: "Zum Admin-Modus wechseln" }),
    ).toBeDisabled();
    await act(async () => {
      resolve();
      await operation;
    });
    expect(
      screen.getByRole("button", { name: "Zum Admin-Modus wechseln" }),
    ).toBeEnabled();
  });
});
