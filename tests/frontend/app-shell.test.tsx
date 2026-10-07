// @vitest-environment jsdom
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
import { ROLE } from "@/definition/Role";
import { LANGUAGE } from "@/language/Language";

import { createUser } from "../helpers/factories";
import { createAccess } from "../helpers/authorization";
import { directoryRoles } from "../helpers/administration-page";

import type { InstanceBranding } from "@/definition/Instance";
import type { User } from "@/definition/User";

const mockedUseSubmit = vi.mocked(useSubmit);

const NO_BRANDING: InstanceBranding = { companyName: null, logoUrl: null };

function renderShell(
  user: User,
  canViewUsers = true,
  initialPath = "/dashboard",
  canViewProjects = false,
  branding: InstanceBranding = NO_BRANDING,
): void {
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
        element: (
          <AppShell
            account={createAccess({
              userId: user.id,
              role: directoryRoles([user.role])[0] ?? null,
            })}
            branding={branding}
            canViewProjects={canViewProjects}
            canViewUsers={canViewUsers}
            user={user}
          />
        ),
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
}

function getSubmitMock(): ReturnType<typeof vi.fn> {
  return mockedUseSubmit.mock.results[0]?.value as ReturnType<typeof vi.fn>;
}

describe("AppShell", () => {
  it("shows connectivity state and an unassigned role in the account menu", async () => {
    const router = createMemoryRouter([
      {
        path: "/",
        element: (
          <AppShell
            user={createUser()}
            account={createAccess({ role: null })}
            branding={NO_BRANDING}
            canViewUsers={false}
            canViewProjects={false}
            isOffline
          />
        ),
      },
    ]);
    render(
      <I18nextProvider i18n={createI18n("de")}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Kontomenü" }));
    expect(screen.getByText("—")).toBeInTheDocument();
  });
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

  it("shows project and task links to users with project access", () => {
    renderShell(createUser(), true, "/dashboard", true);

    expect(
      screen.getAllByRole("link", { name: "Projekte" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("link", { name: "Aufgaben" }).length,
    ).toBeGreaterThan(0);
  });

  it("shows the user management link to permitted viewers", () => {
    renderShell(createUser(), true);

    expect(
      screen.getAllByRole("link", { name: "Benutzerverwaltung" }).length,
    ).toBeGreaterThan(0);
  });

  it("hides the user management link without viewing rights", () => {
    renderShell(createUser({ role: ROLE.EMPLOYEE }), false);

    expect(
      screen.queryByRole("link", { name: "Benutzerverwaltung" }),
    ).not.toBeInTheDocument();
  });

  it("shows the display name and its initial", async () => {
    const user = userEvent.setup();
    renderShell(createUser({ displayName: "Müller", username: "mueller" }));

    expect(screen.getByText("M")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Kontomenü" }));

    expect(await screen.findByText("Müller")).toBeInTheDocument();
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
    await user.click(await screen.findByRole("menuitem", { name: "Logout" }));

    await waitFor(() => {
      expect(getSubmitMock()).toHaveBeenCalledWith(
        {},
        { action: "/logout", method: "post" },
      );
    });
  });

  it("opens the settings from the account menu", async () => {
    const user = userEvent.setup();
    renderShell(createUser());

    await user.click(screen.getByRole("button", { name: "Kontomenü" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Einstellungen" }),
    );

    await waitFor(() => {
      expect(screen.queryByText("Dashboard-Inhalt")).not.toBeInTheDocument();
    });
  });

  it("logs sign-out failures without crashing", async () => {
    const user = userEvent.setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    renderShell(createUser());
    getSubmitMock().mockRejectedValueOnce(new Error("Network broken"));

    await user.click(screen.getByRole("button", { name: "Kontomenü" }));
    await user.click(await screen.findByRole("menuitem", { name: "Logout" }));

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

  it("shows the company name and logo in the sidebar and the mobile menu", async () => {
    renderShell(createUser(), true, "/dashboard", false, {
      companyName: "Muster GmbH",
      logoUrl: "/instance-logo?v=1",
    });

    expect(screen.getByText("Muster GmbH")).toBeInTheDocument();
    expect(
      document.querySelector('img[src="/instance-logo?v=1"]'),
    ).not.toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "Navigation öffnen" }),
    );

    expect(screen.getAllByText("Muster GmbH")).toHaveLength(2);
  });

  it("shows nothing about the company without name and logo", () => {
    renderShell(createUser());

    expect(document.querySelector('img[src^="/instance-logo"]')).toBeNull();
  });
});
