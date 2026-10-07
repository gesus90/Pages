// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { createI18n } from "@/app/lib/i18n";
import SettingsLayoutRoute from "@/app/routes/settings";

function renderLayout(canViewSystem: boolean): void {
  const Stub = createRoutesStub([
    {
      Component: SettingsLayoutRoute,
      children: [
        { Component: () => <p>Persönlicher Inhalt</p>, path: "profile" },
        { Component: () => <p>Systeminhalt</p>, path: "system" },
      ],
      loader: () => ({ canViewSystem }),
      path: "/settings",
    },
  ]);

  render(
    <I18nextProvider i18n={createI18n("de")}>
      <Stub initialEntries={["/settings/profile"]} />
    </I18nextProvider>,
  );
}

describe("SettingsLayoutRoute", () => {
  it("shows the heading, the navigation and the area", async () => {
    renderLayout(true);

    expect(
      await screen.findByRole("heading", { name: "Einstellungen" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Einstellungsbereiche" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Persönlicher Inhalt")).toBeInTheDocument();
  });

  it("opens the system area from the navigation", async () => {
    const user = userEvent.setup();

    renderLayout(true);
    await user.click(await screen.findByRole("link", { name: "System" }));

    expect(await screen.findByText("Systeminhalt")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "System" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("does not list the system area for everyone else", async () => {
    renderLayout(false);

    expect(
      await screen.findByRole("link", { name: "Persönlich" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "System" })).toBeNull();
  });
});
