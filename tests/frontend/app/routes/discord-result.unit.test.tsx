import { screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import DiscordResultRoute, {
  headers,
  loader,
} from "@/app/routes/discord-result";

import {
  i18n,
  pagesRequest,
  renderRoute,
  routeArguments,
} from "./route-fixture";

// The fixture reads the user context of the authentication module.
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

it("keeps the result out of caches and referrers", () => {
  const response = headers();

  expect(response.get("Cache-Control")).toBe("no-store");
  expect(response.get("Referrer-Policy")).toBe("no-referrer");
});

it("reads a known outcome from the address", () => {
  expect(
    loader(routeArguments(pagesRequest("/discord/result?outcome=expired"))),
  ).toEqual({ outcome: "expired" });
});

it("treats a missing or unknown outcome as an invalid link", () => {
  expect(loader(routeArguments(pagesRequest("/discord/result")))).toEqual({
    outcome: "invalid",
  });
  expect(
    loader(routeArguments(pagesRequest("/discord/result?outcome=hacked"))),
  ).toEqual({ outcome: "invalid" });
});

it("tells an authorized visitor the next step", () => {
  renderRoute(DiscordResultRoute, { loaderData: { outcome: "authorized" } });

  expect(screen.getByRole("heading").textContent).toBe(
    i18n.t("discordResult.authorized.title"),
  );
  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("discordResult.nextStep"),
  );
  expect(screen.getByRole("link").getAttribute("href")).toBe("/");
});

it("asks to try again after a failure", () => {
  renderRoute(DiscordResultRoute, { loaderData: { outcome: "failed" } });

  expect(screen.getByRole("heading").textContent).toBe(
    i18n.t("discordResult.failed.title"),
  );
  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("discordResult.tryAgain"),
  );
});
