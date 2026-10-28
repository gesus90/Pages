import { screen } from "@testing-library/react";
import { data } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { resolveSystemSettingsAccess } from "@/app/lib/settings-actions/settings-system-access.server";
import {
  createServerSettingsService,
  handleSystemSettingsAction,
} from "@/app/lib/settings-actions/settings-system-actions.server";
import SettingsSystemRoute, {
  action,
  headers,
  loader,
} from "@/app/routes/settings-system";

import {
  ACTOR,
  formPost,
  headerArguments,
  pagesRequest,
  renderRoute,
  routeArguments,
} from "./route-fixture";

import type { SettingsActionData } from "@/app/lib/settings-actions/settings-action-support.server";

const services = vi.hoisted(() => ({
  instanceSettingsService: { getBranding: vi.fn() },
  wikiService: { getSettings: vi.fn() },
  chatSettingsService: { administration: vi.fn() },
}));
const serverSettings = vi.hoisted(() => ({
  readPort: vi.fn(),
  readStatus: vi.fn(),
  readLogging: vi.fn(),
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => services,
}));
vi.mock("@/app/lib/settings-actions/settings-system-access.server", () => ({
  resolveSystemSettingsAccess: vi.fn(),
}));
vi.mock("@/app/lib/settings-actions/settings-system-actions.server", () => ({
  createServerSettingsService: vi.fn(
    async (): Promise<unknown> => serverSettings,
  ),
  handleSystemSettingsAction: vi.fn(),
}));
vi.mock("@/app/components/settings/system-section", () => ({
  SystemSection: (props: {
    readonly port: number;
    readonly branding: { readonly companyName: string };
  }): React.ReactElement => (
    <p>{`system ${props.port} ${props.branding.companyName}`}</p>
  ),
}));
vi.mock("@/app/components/settings/admin-mode-required", () => ({
  AdminModeRequired: (): React.ReactElement => <p>admin mode required</p>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  serverSettings.readPort.mockResolvedValue(3100);
  serverSettings.readStatus.mockResolvedValue({ version: "1" });
  serverSettings.readLogging.mockResolvedValue({ retentionDays: 7 });
  services.instanceSettingsService.getBranding.mockResolvedValue({
    companyName: "Acme",
  });
  services.wikiService.getSettings.mockResolvedValue({
    trashRetentionDays: 30,
  });
  services.chatSettingsService.administration.mockResolvedValue({
    instruction: "",
  });
});

it("keeps system documents out of caches and keeps parent headers", () => {
  const result = new Headers(
    headers(headerArguments({ "X-Frame-Options": "DENY" })),
  );

  expect(result.get("Cache-Control")).toBe("no-store");
  expect(result.get("X-Frame-Options")).toBe("DENY");
});

it("requires the user of the authentication middleware", async () => {
  await expect(
    loader(routeArguments(pagesRequest("/settings/system"), { user: null })),
  ).rejects.toThrow("Authenticated middleware did not provide a user.");
});

it("asks for the admin mode before reading any system setting", async () => {
  vi.mocked(resolveSystemSettingsAccess).mockResolvedValue("adminModeRequired");

  await expect(
    loader(routeArguments(pagesRequest("/settings/system"), { user: ACTOR })),
  ).resolves.toEqual({ access: "adminModeRequired" });
  expect(createServerSettingsService).not.toHaveBeenCalled();
});

it("loads every system setting for a granted administrator", async () => {
  vi.mocked(resolveSystemSettingsAccess).mockResolvedValue("granted");

  await expect(
    loader(routeArguments(pagesRequest("/settings/system"), { user: ACTOR })),
  ).resolves.toEqual({
    access: "granted",
    branding: { companyName: "Acme" },
    chatSettings: { instruction: "" },
    logging: { retentionDays: 7 },
    port: 3100,
    status: { version: "1" },
    wikiSettings: { trashRetentionDays: 30 },
  });
  expect(serverSettings.readLogging).toHaveBeenCalledWith(ACTOR);
});

it("hands a system settings post to its handlers", async () => {
  const outcome = data<SettingsActionData>({ intent: "revoke-session" });
  vi.mocked(handleSystemSettingsAction).mockResolvedValue(outcome);

  await expect(
    action(
      routeArguments(formPost("/settings/system", { intent: "update-port" }), {
        user: ACTOR,
      }),
    ),
  ).resolves.toBe(outcome);
  expect(vi.mocked(handleSystemSettingsAction).mock.calls[0]?.[0]).toBe(
    "update-port",
  );
});

it("renders the system section for a granted administrator", () => {
  renderRoute(SettingsSystemRoute, {
    loaderData: {
      access: "granted",
      branding: { companyName: "Acme" },
      chatSettings: {},
      logging: {},
      port: 3100,
      status: {},
      wikiSettings: {},
    },
  });

  expect(screen.getByText("system 3100 Acme")).toBeTruthy();
});

it("asks everybody else for the admin mode", () => {
  renderRoute(SettingsSystemRoute, {
    loaderData: { access: "adminModeRequired" },
  });

  expect(screen.getByText("admin mode required")).toBeTruthy();
});
