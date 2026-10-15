import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdministrationError } from "@/backend/error/AdministrationError";
import { handleSettingsAction } from "@/app/lib/settings-actions/settings-actions.server";
import { handleSetMode } from "@/app/lib/settings-actions/settings-mode-action.server";
import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";
import {
  canSeeSystemSettings,
  listsAdminSettings,
  resolveSystemSettingsAccess,
} from "@/app/lib/settings-actions/settings-system-access.server";

import {
  accountFixture,
  administratorFixture,
} from "../../backend/auth/account-fixture";
import { thrownResponse } from "../server-lib/request-fixtures";
import { contextFor } from "../server-lib/route-arguments";
import {
  ACTOR,
  outcomeOf,
  servicesOf,
  settingsContext,
  thrownStatus,
} from "./action-fixtures";

import type { FormFields } from "./action-fixtures";

const services = vi.hoisted(() => ({
  administrationService: { setMode: vi.fn(), getContext: vi.fn() },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

beforeEach(() => {
  vi.resetAllMocks();
});

function postRequest(method = "POST"): Request {
  return new Request("http://pages.invalid/settings/profile", {
    body: method === "POST" ? new URLSearchParams({ intent: "x" }) : undefined,
    method,
  });
}

describe("readSettingsRequest", () => {
  it("gathers user, form fields and services of a POST", async () => {
    const request = postRequest();

    const result = await readSettingsRequest({
      context: contextFor(ACTOR),
      request,
    });

    expect(result.user).toBe(ACTOR);
    expect(result.request).toBe(request);
    expect(result.formData.get("intent")).toBe("x");
    expect(result.services).toBe(services);
  });

  it.each(["GET", "PUT", "DELETE", "PATCH"])(
    "answers %s with 405 and names POST",
    async (method) => {
      const request = new Request("http://pages.invalid/settings", { method });

      const response = await thrownResponse(
        readSettingsRequest({ context: contextFor(ACTOR), request }),
      );

      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST");
    },
  );

  it("answers 403 without a signed-in user and reads no body", async () => {
    const request = postRequest();

    const status = await thrownStatus(
      readSettingsRequest({ context: contextFor(null), request }),
    );

    expect(status).toBe(403);
    expect(request.bodyUsed).toBe(false);
  });
});

describe("handleSettingsAction", () => {
  it.each([
    "",
    "update-port",
    "update-company-name",
    "constructor",
    "toString",
  ])("answers 400 for the intent %j", async (intent) => {
    const status = await thrownStatus(
      handleSettingsAction(intent, settingsContext(services, {})),
    );

    expect(status).toBe(400);
  });

  it("answers 400 for a missing intent", async () => {
    const status = await thrownStatus(
      handleSettingsAction(null, settingsContext(services, {})),
    );

    expect(status).toBe(400);
  });

  it("answers 400 for a file as intent", async () => {
    const status = await thrownStatus(
      handleSettingsAction(
        new File(["set-mode"], "set-mode"),
        settingsContext(services, {}),
      ),
    );

    expect(status).toBe(400);
  });
});

describe("handleSetMode", () => {
  it.each(["admin", "role"] as const)(
    "switches to the %s mode",
    async (mode) => {
      const result = await handleSetMode(settingsContext(services, { mode }));

      const outcome = await outcomeOf(result);

      expect(outcome.status).toBe(200);
      expect(outcome.body).toEqual({ intent: "set-mode", ok: true });
      expect(services.administrationService.setMode).toHaveBeenCalledWith(
        ACTOR.id,
        mode,
      );
    },
  );

  it.each([undefined, "", "ADMIN", "root"])(
    "answers 400 for the mode %j without calling the service",
    async (mode) => {
      const fields: FormFields = mode === undefined ? {} : { mode };

      const status = await thrownStatus(
        handleSetMode(settingsContext(services, fields)),
      );

      expect(status).toBe(400);
      expect(services.administrationService.setMode).not.toHaveBeenCalled();
    },
  );

  it("answers 403 when the account may not use the admin mode", async () => {
    services.administrationService.setMode.mockRejectedValue(
      new AdministrationError("forbidden"),
    );

    const outcome = await outcomeOf(
      await handleSetMode(settingsContext(services, { mode: "admin" })),
    );

    expect(outcome.status).toBe(403);
    expect(outcome.body).toEqual({ intent: "set-mode", ok: false });
  });

  it("does not swallow an unexpected failure", async () => {
    services.administrationService.setMode.mockRejectedValue(
      new Error("disk full"),
    );

    await expect(
      handleSetMode(settingsContext(services, { mode: "role" })),
    ).rejects.toThrow("disk full");
  });
});

describe("system settings access", () => {
  const employee = accountFixture();
  const adminInAdminMode = administratorFixture();
  const adminInRoleMode = accountFixture({ isAdmin: true, mode: "role" });
  const inactiveAdmin = administratorFixture({ isActive: false });

  it("lets only active administrators see the system settings", () => {
    expect(canSeeSystemSettings(adminInAdminMode)).toBe(true);
    expect(canSeeSystemSettings(adminInRoleMode)).toBe(true);
    expect(canSeeSystemSettings(employee)).toBe(false);
    expect(canSeeSystemSettings(inactiveAdmin)).toBe(false);
  });

  it("lists the admin areas only in the active admin mode", () => {
    expect(listsAdminSettings(adminInAdminMode)).toBe(true);
    expect(listsAdminSettings(adminInRoleMode)).toBe(false);
    expect(listsAdminSettings(employee)).toBe(false);
    expect(listsAdminSettings(inactiveAdmin)).toBe(false);
  });

  it.each([
    ["grants the admin mode", administratorFixture(), "granted"],
    [
      "asks an administrator in the role mode to switch",
      accountFixture({ isAdmin: true, mode: "role" }),
      "adminModeRequired",
    ],
  ])("%s", async (caseName, account, expected) => {
    services.administrationService.getContext.mockResolvedValue(account);

    const access = await resolveSystemSettingsAccess(
      servicesOf(services),
      ACTOR,
    );

    expect(access).toBe(expected);
    expect(services.administrationService.getContext).toHaveBeenCalledWith(
      ACTOR.id,
    );
  });

  it.each([
    ["an employee", accountFixture()],
    ["an inactive administrator", administratorFixture({ isActive: false })],
  ])("answers 403 for %s", async (caseName, account) => {
    services.administrationService.getContext.mockResolvedValue(account);

    const status = await thrownStatus(
      resolveSystemSettingsAccess(servicesOf(services), ACTOR),
    );

    expect(status).toBe(403);
  });
});
