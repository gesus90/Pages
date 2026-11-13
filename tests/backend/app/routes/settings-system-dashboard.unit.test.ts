import { beforeEach, expect, it, vi } from "vitest";

import { loader } from "@/app/routes/settings-system-dashboard";

import { administratorFixture } from "../../backend/auth/account-fixture";
import { ACTOR, thrownStatus } from "../actions/action-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

const services = vi.hoisted(() => ({
  administrationService: { getContext: vi.fn() },
  systemDashboardService: { read: vi.fn() },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

const ENDPOINT = "http://pages.invalid/settings-api/system/dashboard";
const MEASUREMENT = {
  facts: {
    version: "0.1.0",
    build: {
      commit: "281a48950123456789abcdef0123456789abcdef01",
      builtAt: "2026-11-13T10:12:00+01:00",
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  services.administrationService.getContext.mockResolvedValue(
    administratorFixture(),
  );
  services.systemDashboardService.read.mockResolvedValue(MEASUREMENT);
});

it("returns build metadata only to an administrator in active admin mode, without caching", async () => {
  const response = await loader(
    routeArguments(new Request(ENDPOINT), ACTOR, {}),
  );

  expect(await response.json()).toEqual(MEASUREMENT);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(
    services.administrationService.getContext,
  ).toHaveBeenCalledExactlyOnceWith(ACTOR.id);
  expect(services.systemDashboardService.read).toHaveBeenCalledExactlyOnceWith(
    administratorFixture(),
  );
});

it.each([{ isAdmin: false }, { isActive: false }, { mode: "role" as const }])(
  "refuses build metadata and metrics before reading them for %j",
  async (changes) => {
    services.administrationService.getContext.mockResolvedValue(
      administratorFixture(changes),
    );

    expect(
      await thrownStatus(
        loader(routeArguments(new Request(ENDPOINT), ACTOR, {})),
      ),
    ).toBe(403);
    expect(services.systemDashboardService.read).not.toHaveBeenCalled();
  },
);

it("refuses an unauthenticated request before reading account or system data", async () => {
  expect(
    await thrownStatus(loader(routeArguments(new Request(ENDPOINT), null, {}))),
  ).toBe(403);
  expect(services.administrationService.getContext).not.toHaveBeenCalled();
  expect(services.systemDashboardService.read).not.toHaveBeenCalled();
});
