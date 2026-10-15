import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";

import { BackgroundSaveStatus } from "@/app/components/common/background-save-status";
import { DraftProvider } from "@/app/components/common/draft-provider";
import { NavigationContent } from "@/app/components/common/navigation-content";
import { createI18n } from "@/app/lib/i18n";

import { deferred, wikiPage, WikiEditorFixture } from "./draft-fixture";

function ErrorView(): React.ReactElement {
  return (
    <>
      <h1>Could not load target</h1>
      <BackgroundSaveStatus />
      <Link to="/wiki/one">Back to draft</Link>
    </>
  );
}

it("retains a pending save even when the target loader replaces the route with an error", async () => {
  const save = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(() => save.promise),
  );
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <Link to="/broken">Broken target</Link>
            <BackgroundSaveStatus />
            <NavigationContent />
          </>
        ),
        ErrorBoundary: ErrorView,
        children: [
          {
            path: "/wiki/one",
            loader: () => wikiPage(),
            Component: WikiEditorFixture,
          },
          {
            path: "/broken",
            loader: () => {
              throw new Response("Unavailable", { status: 503 });
            },
          },
        ],
      },
    ],
    { initialEntries: ["/wiki/one"] },
  );
  // Root Layout owns this provider in production, above route error boundaries.
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <DraftProvider>
        <RouterProvider router={router} />
      </DraftProvider>
    </I18nextProvider>,
  );
  await screen.findByRole("textbox");
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Survives error" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save now" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("link", { name: "Broken target" }));
  });
  expect(screen.getByRole("heading").textContent).toBe("Could not load target");
  expect(screen.getByText("Saving …")).toBeTruthy();
  await act(async () => {
    save.resolve(
      Response.json({
        ok: true,
        saved: { ...wikiPage(), content: "Survives error", revision: 2 },
      }),
    );
  });
  expect(screen.getByText("Saved")).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole("link", { name: "Back to draft" }));
  });
  expect(screen.getByRole("textbox").getAttribute("value")).toBe(
    "Survives error",
  );
});
