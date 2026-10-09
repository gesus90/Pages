import { describe, expect, it, vi } from "vitest";

import {
  canSeeSystemSettings,
  listsAdminSettings,
  resolveSystemSettingsAccess,
} from "@/app/lib/settings-actions/settings-system-access.server";

import { createAccess } from "../helpers/authorization";
import { createUser } from "../helpers/factories";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { AccountAccess } from "@/definition/Authorization";

function createServices(account: AccountAccess): ApplicationServices {
  return {
    administrationService: { getContext: vi.fn().mockResolvedValue(account) },
  } as unknown as ApplicationServices;
}

describe("canSeeSystemSettings", () => {
  it.each([
    [
      "an active admin in the admin mode",
      { isAdmin: true, mode: "admin" },
      true,
    ],
    ["an active admin in the role mode", { isAdmin: true, mode: "role" }, true],
    ["a deactivated admin", { isAdmin: true, isActive: false }, false],
    ["an account with a role only", { isAdmin: false }, false],
  ] as const)("is decided for %s", (_name, overrides, expected) => {
    expect(canSeeSystemSettings(createAccess(overrides))).toBe(expected);
  });
});

describe("listsAdminSettings", () => {
  // A7 §21.1: System and Agents follow the active mode, so a switch toggles both entries.
  it.each([
    [
      "an active admin in the admin mode",
      { isAdmin: true, mode: "admin" },
      true,
    ],
    [
      "an active admin in the role mode",
      { isAdmin: true, mode: "role" },
      false,
    ],
    [
      "a deactivated admin in the admin mode",
      { isAdmin: true, isActive: false, mode: "admin" },
      false,
    ],
    ["an account with a role only", { isAdmin: false }, false],
  ] as const)("is decided for %s", (_name, overrides, expected) => {
    expect(listsAdminSettings(createAccess(overrides))).toBe(expected);
  });
});

describe("resolveSystemSettingsAccess", () => {
  it("grants an administrator in the admin mode", async () => {
    const services = createServices(
      createAccess({ isAdmin: true, mode: "admin" }),
    );

    await expect(
      resolveSystemSettingsAccess(services, createUser()),
    ).resolves.toBe("granted");
  });

  it("asks an administrator in the role mode for the admin mode", async () => {
    const services = createServices(
      createAccess({ isAdmin: true, mode: "role" }),
    );

    await expect(
      resolveSystemSettingsAccess(services, createUser()),
    ).resolves.toBe("adminModeRequired");
  });

  it("answers 403 for everyone else", async () => {
    const services = createServices(createAccess({ isAdmin: false }));
    const failure = await resolveSystemSettingsAccess(
      services,
      createUser(),
    ).catch((error: unknown) => error);

    expect((failure as Response).status).toBe(403);
  });
});
