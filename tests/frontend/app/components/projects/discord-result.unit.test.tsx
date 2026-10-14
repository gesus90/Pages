import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it } from "vitest";

import DiscordResultRoute from "@/app/routes/discord-result";
import { createI18n } from "@/app/lib/i18n";

import type { Language } from "@/language/Language";

async function renderResult(
  outcome: string,
  language: Language,
): Promise<void> {
  const router = createMemoryRouter(
    [
      {
        Component: DiscordResultRoute,
        loader: () => ({ outcome }),
        path: "/discord/result",
      },
    ],
    { initialEntries: [`/discord/result?outcome=${outcome}`] },
  );

  render(
    <I18nextProvider i18n={createI18n(language)}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
  await screen.findByRole("heading");
}

it("tells a phone that the server was authorized and where to confirm", async () => {
  await renderResult("authorized", "en");

  expect(screen.getByRole("heading").textContent).toBe("Server authorized");
  expect(screen.getByRole("status").textContent).toContain(
    "confirm server and channel there",
  );
  expect(
    screen.getByRole("link", { name: "Open Pages" }).getAttribute("href"),
  ).toBe("/");
});

it("tells what to do when the link was used up, expired or the authorization failed", async () => {
  for (const [outcome, title] of [
    ["used", "Link already used"],
    ["expired", "Link expired"],
    ["denied", "Authorization cancelled"],
    ["failed", "Authorization failed"],
    ["invalid", "Link not valid"],
    ["not_configured", "Discord is not set up"],
  ] as const) {
    await renderResult(outcome, "en");

    expect(screen.getByRole("heading").textContent).toBe(title);
    expect(screen.getByRole("status").textContent).toContain(
      "Start the connection again in Pages",
    );
    document.body.innerHTML = "";
  }
});

it("speaks German to a German visitor", async () => {
  await renderResult("authorized", "de");

  expect(screen.getByRole("heading").textContent).toBe("Server autorisiert");
  expect(screen.getByRole("link", { name: "Pages öffnen" })).toBeTruthy();
});
