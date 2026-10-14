import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it } from "vitest";

import { ProjectIntegrationsTab } from "@/app/components/projects/project-integrations-tab";
import { createI18n } from "@/app/lib/i18n";

import { managerState, scriptServer, success } from "./discord-fixture";

function renderTab(isDiscordConnected: boolean): void {
  const router = createMemoryRouter(
    [
      {
        element: (
          <I18nextProvider i18n={createI18n("en")}>
            <ProjectIntegrationsTab
              canWrite
              integration={null}
              isDiscordConnected={isDiscordConnected}
              projectId="alpha"
            />
          </I18nextProvider>
        ),
        path: "/",
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);
}

it("replaces the placeholder by a card that opens the Discord panel", async () => {
  scriptServer([success(managerState())]);
  renderTab(false);

  const card = screen.getByRole("button", {
    name: "Open settings for Discord",
  });

  expect(card.getAttribute("aria-pressed")).toBe("false");
  // Only the interfaces that still wait are marked as planned.
  expect(screen.getAllByText("Planned")).toHaveLength(4);

  fireEvent.click(card);

  expect(
    await screen.findByRole("dialog", { name: "Interface settings" }),
  ).toBeTruthy();
  expect(
    await screen.findByRole("button", { name: "Connect Discord" }),
  ).toBeTruthy();
  expect(card.getAttribute("aria-pressed")).toBe("true");
});

it("marks the card as connected when the project is connected", () => {
  scriptServer([success(managerState())]);
  renderTab(true);

  const card = screen.getByRole("button", {
    name: "Open settings for Discord",
  });

  expect(card.textContent).toContain("Connected");
});

it("shows one panel at a time", async () => {
  scriptServer([success(managerState())]);
  renderTab(false);

  fireEvent.click(
    screen.getByRole("button", { name: "Open settings for Discord" }),
  );
  await screen.findByRole("button", { name: "Connect Discord" });
  fireEvent.click(
    screen.getByRole("button", { name: "Open settings for GitHub" }),
  );

  expect(screen.queryByRole("button", { name: "Connect Discord" })).toBeNull();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
});

it("closes the panel with the close button", async () => {
  scriptServer([success(managerState())]);
  renderTab(false);

  fireEvent.click(
    screen.getByRole("button", { name: "Open settings for Discord" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Close panel" }));

  expect(screen.queryByRole("dialog")).toBeNull();
});
