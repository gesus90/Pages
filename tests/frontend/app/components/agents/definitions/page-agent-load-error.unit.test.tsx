import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PageAgentLoadError } from "@/app/components/agents/definitions/page-agent-load-error";
import { createI18n } from "@/app/lib/i18n";

const i18n = createI18n("de");

/** Opens the error page for a loader that fails with the given error. */
function renderFailure(loader: () => never): void {
  const router = createMemoryRouter([
    {
      path: "/",
      loader,
      Component: () => null,
      ErrorBoundary: PageAgentLoadError,
    },
  ]);
  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

it("keeps the page chrome and offers a retry when the agents cannot be loaded", async () => {
  const loader = vi.fn((): never => {
    throw new Error("database offline");
  });
  renderFailure(loader);

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe(i18n.t("pageAgents.loadError"));
  expect(
    screen.getByRole("heading", { name: i18n.t("navigation.agentList") }),
  ).toBeDefined();
  expect(alert.textContent).not.toContain("database offline");

  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("pageAgents.retry") }),
  );

  await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
});

it("explains a refused access and offers no retry", async () => {
  renderFailure(() => {
    throw new Response(null, { status: 403 });
  });

  const alert = await screen.findByRole("alert");

  expect(alert.textContent).toBe(i18n.t("errorPage.forbidden.message"));
  expect(
    screen.queryByRole("button", { name: i18n.t("pageAgents.retry") }),
  ).toBeNull();
});

it("treats a different HTTP failure like a load error", async () => {
  renderFailure(() => {
    throw new Response(null, { status: 500 });
  });

  const alert = await screen.findByRole("alert");

  expect(alert.textContent).toBe(i18n.t("pageAgents.loadError"));
  expect(
    screen.getByRole("button", { name: i18n.t("pageAgents.retry") }),
  ).toBeDefined();
});
