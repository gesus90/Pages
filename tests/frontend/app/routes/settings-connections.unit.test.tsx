import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { createI18n } from "@/app/lib/i18n";
import { getApplicationServices } from "@/app/lib/services.server";
import SettingsConnectionsRoute, {
  ErrorBoundary,
} from "@/app/routes/settings-connections";

import type * as ReactRouter from "react-router";
import type { McpConnectionsView } from "@/definition/McpConnections";

const revalidate = vi.hoisted(() => vi.fn());
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  useRevalidator: () => ({ revalidate }),
}));
vi.mock("@/app/lib/auth.server", () => ({
  getAuthenticatedUser: vi.fn(() => {
    throw new Error("Server auth must not run in a UI unit");
  }),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(() => {
    throw new Error("Server services must not run in a UI unit");
  }),
}));
beforeEach(() => {
  revalidate.mockReset();
});

const view: McpConnectionsView = {
  origin: "https://pages.example",
  packageVersion: "1.2.3",
  tokens: [],
  validityDays: 30,
};
const i18n = createI18n("en");

function renderRoute(element: React.ReactElement): void {
  const router = createMemoryRouter([
    { path: "/", loader: () => view, element },
  ]);
  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

it("shows the empty connections state and opens instructions using public metadata", async () => {
  renderRoute(<SettingsConnectionsRoute />);
  expect(
    await screen.findByText(i18n.t("settings.connections.stdio.empty.title")),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("settings.connections.stdio.pair"),
    }),
  );
  expect(
    screen.getByRole("dialog", {
      name: i18n.t("settings.connections.guide.title"),
    }),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "node pages-mcp-v1.2.3.js pair --url https://pages.example",
    ),
  ).toBeTruthy();
  expect(getAuthenticatedUser).not.toHaveBeenCalled();
  expect(getApplicationServices).not.toHaveBeenCalled();
});

it("renders a recoverable loading failure and lets the user retry", async () => {
  renderRoute(<ErrorBoundary />);
  expect((await screen.findByRole("alert")).textContent).toBe(
    i18n.t("settings.connections.error.load"),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("settings.connections.error.retry"),
    }),
  );
  expect(revalidate).toHaveBeenCalledTimes(1);
  expect(getApplicationServices).not.toHaveBeenCalled();
});
