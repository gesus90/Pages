import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it } from "vitest";

import { ConnectionsPanel } from "@/app/components/settings/connections/connections-panel";
import { createI18n } from "@/app/lib/i18n";

import type { ConnectionsView } from "@/definition/Connections";

const i18n = createI18n("de");

const BASE: ConnectionsView = {};

function renderPanel(view: ConnectionsView): void {
  const router = createMemoryRouter([
    {
      path: "/",
      loader: () => view,
      action: () => null,
      element: <ConnectionsPanel view={view} />,
    },
  ]);

  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

it("shows the Pica Mobile card for an administrator", async () => {
  renderPanel({
    ...BASE,
    picaMobile: {
      port: 3001,
      isListening: true,
      listenError: null,
      host: "192.168.0.52",
    },
  });

  expect(
    await screen.findByRole("heading", { name: "Pica Mobile" }),
  ).toBeTruthy();
});

it("shows no Pica Mobile card to anyone else", async () => {
  renderPanel(BASE);

  expect(
    await screen.findByRole("heading", { name: "Verbindungen" }),
  ).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Pica Mobile" })).toBeNull();
  expect(screen.queryByLabelText("WebSocket-Port")).toBeNull();
});
