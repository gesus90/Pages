import { beforeEach, expect, it, vi } from "vitest";

import { action, headers, loader } from "@/app/routes/settings-system";

import { administratorFixture } from "../../backend/auth/account-fixture";
import { routeArguments } from "../server-lib/route-arguments";
import { ACTOR, thrownStatus } from "../actions/action-fixtures";

const services = vi.hoisted(() => ({
  getContext: vi.fn(),
  createServerSettings: vi.fn(),
  handleAction: vi.fn(),
  readPort: vi.fn(async () => 3197),
  readStatus: vi.fn(async () => ({
    version: "synthetic",
    databasePath: null,
    startedAt: "today",
  })),
  readLogging: vi.fn(async () => ({
    retentionDays: 30,
    status: { state: "healthy" },
  })),
  getBranding: vi.fn(),
  wikiSettings: vi.fn(),
  chatSettings: vi.fn(),
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    administrationService: { getContext: services.getContext },
    instanceSettingsService: { getBranding: services.getBranding },
    wikiService: { getSettings: services.wikiSettings },
    chatSettingsService: { administration: services.chatSettings },
  }),
}));
vi.mock("@/app/lib/settings-actions/settings-system-actions.server", () => ({
  createServerSettingsService: services.createServerSettings,
  handleSystemSettingsAction: services.handleAction,
}));

const SYSTEM_URL = "http://pages.invalid/settings/system";

beforeEach(() => {
  vi.clearAllMocks();
  services.getContext.mockResolvedValue(administratorFixture());
  services.createServerSettings.mockResolvedValue({
    readPort: services.readPort,
    readStatus: services.readStatus,
    readLogging: services.readLogging,
  });
});

it.each([{ isAdmin: false }, { isActive: false }])(
  "denies system settings before reading any administrator content for %j",
  async (changes) => {
    services.getContext.mockResolvedValueOnce(administratorFixture(changes));
    expect(
      await thrownStatus(
        loader(routeArguments(new Request(SYSTEM_URL), ACTOR, {})),
      ),
    ).toBe(403);
    expect(services.createServerSettings).not.toHaveBeenCalled();
    expect(services.getBranding).not.toHaveBeenCalled();
  },
);

it("returns only the admin-mode notice for an administrator in role mode, keeping the system form hidden", async () => {
  services.getContext.mockResolvedValueOnce(
    administratorFixture({ mode: "role" }),
  );
  expect(
    await loader(routeArguments(new Request(SYSTEM_URL), ACTOR, {})),
  ).toEqual({ access: "adminModeRequired" });
  expect(services.createServerSettings).not.toHaveBeenCalled();
  expect(services.readPort).not.toHaveBeenCalled();
});

it("makes the system section available in current admin mode", async () => {
  const result = await loader(
    routeArguments(new Request(SYSTEM_URL), ACTOR, {}),
  );
  expect(result).toMatchObject({ access: "granted", port: 3197 });
  expect(services.getContext).toHaveBeenCalledExactlyOnceWith(ACTOR.id);
  expect(services.readLogging).toHaveBeenCalledExactlyOnceWith(ACTOR);
});

it("rejects an unauthenticated direct form POST before dispatch", async () => {
  const request = new Request(SYSTEM_URL, {
    method: "POST",
    body: new URLSearchParams({
      intent: "update-acp-resources",
      maxConcurrentAcpSessions: "0",
    }),
  });
  expect(await thrownStatus(action(routeArguments(request, null, {})))).toBe(
    403,
  );
  expect(services.handleAction).not.toHaveBeenCalled();
});

it.each(["GET", "PUT", "DELETE"])(
  "refuses %s form mutations before dispatch",
  async (method) => {
    expect(
      await thrownStatus(
        action(routeArguments(new Request(SYSTEM_URL, { method }), ACTOR, {})),
      ),
    ).toBe(405);
    expect(services.handleAction).not.toHaveBeenCalled();
  },
);

it("keeps system documents and action snapshots uncacheable and preserves parent security headers", () => {
  const responseHeaders = new Headers(
    headers({
      parentHeaders: new Headers({
        "X-Frame-Options": "DENY",
        "Cache-Control": "public",
      }),
      actionHeaders: new Headers(),
      loaderHeaders: new Headers(),
      errorHeaders: undefined,
    }),
  );
  expect(responseHeaders.get("Cache-Control")).toBe("no-store");
  expect(responseHeaders.get("X-Frame-Options")).toBe("DENY");
});
