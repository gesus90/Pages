import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return {
    ...actual,
    useSubmit: vi.fn(),
  };
});

import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider, useSubmit } from "react-router";

import { AppShell } from "@/app/components/common/app-shell";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

import type { User } from "@/definition/User";

const mockedUseSubmit = vi.mocked(useSubmit);

function createUser(overrides: Partial<User> = {}): User {
  return {
    displayName: "Admin",
    id: "user-1",
    username: "admin",
    ...overrides,
  };
}

function renderShell(user: User, initialPath = "/dashboard"): void {
  const submit = vi.fn().mockResolvedValue(undefined);
  mockedUseSubmit.mockReturnValue(submit);

  const i18n = createI18n(LANGUAGE.GERMAN);
  const router = createMemoryRouter(
    [
      {
        children: [
          { element: <p>Dashboard-Inhalt</p>, path: "dashboard" },
          { element: <p>Einstellungen</p>, path: "settings" },
        ],
        element: <AppShell user={user} />,
        path: "/",
      },
    ],
    { initialEntries: [initialPath] },
  );

  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );

  return undefined;
}

function getSubmitMock(): ReturnType<typeof vi.fn> {
  return mockedUseSubmit.mock.results[0]?.value as ReturnType<typeof vi.fn>;
}

describe("AppShell", () => {
  it("renders workspace navigation with localized labels", () => {
    renderShell(createUser());

    expect(
      screen.getAllByRole("link", { name: "Dashboard" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("link", { name: "Einstellungen" }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Dashboard-Inhalt")).toBeInTheDocument();
  });

  it("shows the display name and its initial", () => {
    renderShell(createUser({ displayName: "Müller", username: "mueller" }));

    expect(screen.getByText("Müller")).toBeInTheDocument();
    expect(screen.getByText("M")).toBeInTheDocument();
  });

  it("falls back to the username for a blank display name", () => {
    renderShell(createUser({ displayName: "   ", username: "admin" }));

    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("renders an empty avatar for blank names", () => {
    renderShell(createUser({ displayName: "", username: "" }));

    const menus = screen.getAllByRole("button", { name: "Kontomenü" });

    expect(menus.length).toBeGreaterThan(0);
  });

  it("signs out through the account menu", async () => {
    const user = userEvent.setup();
    renderShell(createUser());

    await user.click(screen.getByRole("button", { name: "Kontomenü" }));
    await user.click(await screen.findByRole("menuitem", { name: "Abmelden" }));

    await waitFor(() => {
      expect(getSubmitMock()).toHaveBeenCalledWith(
        {},
        { action: "/logout", method: "post" },
      );
    });
  });

  it("logs sign-out failures without crashing", async () => {
    const user = userEvent.setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    renderShell(createUser());
    getSubmitMock().mockRejectedValueOnce(new Error("Network broken"));

    await user.click(screen.getByRole("button", { name: "Kontomenü" }));
    await user.click(await screen.findByRole("menuitem", { name: "Abmelden" }));

    await waitFor(() => {
      expect(error).toHaveBeenCalledWith(
        "Pages could not end the session.",
        expect.any(Error),
      );
    });

    error.mockRestore();
  });

  it("opens the mobile navigation and closes it again", async () => {
    const user = userEvent.setup();
    renderShell(createUser());

    await user.click(screen.getByRole("button", { name: "Navigation öffnen" }));

    expect(
      await screen.findByRole("dialog", { name: "Hauptnavigation" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Navigation schließen" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Hauptnavigation" }),
      ).not.toBeInTheDocument();
    });
  });

  it("closes the mobile navigation after choosing a destination", async () => {
    const user = userEvent.setup();
    renderShell(createUser());

    await user.click(screen.getByRole("button", { name: "Navigation öffnen" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Hauptnavigation",
    });
    const dashboardLinks = screen.getAllByRole("link", {
      name: "Dashboard",
    });
    const sheetLink = dashboardLinks.find((link) =>
      dialog.contains(link),
    ) as HTMLElement;

    await user.click(sheetLink);

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Hauptnavigation" }),
      ).not.toBeInTheDocument();
    });
  });

  it("navigates to settings from the sidebar", async () => {
    const user = userEvent.setup();
    renderShell(createUser());

    const settingsLinks = screen.getAllByRole("link", {
      name: "Einstellungen",
    });
    await user.click(settingsLinks[0] as HTMLElement);

    await waitFor(() => {
      expect(screen.queryByText("Dashboard-Inhalt")).not.toBeInTheDocument();
    });
    expect(
      screen.getAllByRole("link", { name: "Einstellungen" })[0],
    ).toHaveAttribute("aria-current", "page");
  });
});
