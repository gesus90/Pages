import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/auth.server", () => ({
  authenticatedUserContext: {},
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: vi.fn(),
}));

import { getApplicationServices } from "@/app/lib/services.server";
import { action, loader } from "@/app/routes/settings-system";
import { PermissionService } from "@/backend/auth/PermissionService";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";

import { PAGES_VERSION } from "@/definition/Version";

import { createAccess } from "../helpers/authorization";
import { createUser } from "../helpers/factories";

import type { PagesRuntime } from "@/backend/runtime/PagesRuntime";
import type { AccountAccess } from "@/definition/Authorization";
import type { User } from "@/definition/User";

const BRANDING = { companyName: "Muster GmbH", logoUrl: null };
const ADMIN_MODE = createAccess({ isAdmin: true, mode: "admin" });
const ROLE_MODE = createAccess({ isAdmin: true, mode: "role" });

function useAccount(account: AccountAccess): void {
  vi.mocked(getApplicationServices).mockResolvedValue({
    administrationService: {
      getContext: vi.fn().mockResolvedValue(account),
      setMode: vi.fn().mockResolvedValue(undefined),
    },
    instanceSettingsService: {
      getBranding: vi.fn().mockResolvedValue(BRANDING),
    },
    wikiService: {
      getSettings: vi.fn().mockResolvedValue({ trashRetentionDays: 30 }),
    },
    permissionService: new PermissionService(
      vi.fn().mockResolvedValue(account),
    ),
  } as unknown as Awaited<ReturnType<typeof getApplicationServices>>);
}

function createContext(user: User | null): { get: ReturnType<typeof vi.fn> } {
  return { get: vi.fn().mockReturnValue(user) };
}

function loaderArguments(user: User | null): Parameters<typeof loader>[0] {
  return {
    context: createContext(user),
    params: {},
    request: new Request("http://pages.invalid/settings/system"),
  } as unknown as Parameters<typeof loader>[0];
}

function actionArguments(
  entries: Record<string, string>,
): Parameters<typeof action>[0] {
  return {
    context: createContext(createUser()),
    params: {},
    request: new Request("http://pages.invalid/settings/system", {
      body: new URLSearchParams(entries),
      method: "POST",
    }),
  } as unknown as Parameters<typeof action>[0];
}

describe("system settings route", () => {
  const update = vi.fn();

  beforeEach(() => {
    update.mockReset().mockResolvedValue({});
    vi.mocked(getPagesRuntime).mockResolvedValue({
      configFile: {
        read: vi.fn().mockResolvedValue({
          databasePath: "/data/pages.duckdb",
          firstRun: false,
          port: 4100,
        }),
        update,
      },
    } as unknown as PagesRuntime);
  });

  describe("loader", () => {
    it("returns the stored port to an administrator in the admin mode", async () => {
      useAccount(ADMIN_MODE);

      await expect(loader(loaderArguments(createUser()))).resolves.toEqual({
        access: "granted",
        branding: BRANDING,
        port: 4100,
        status: {
          databasePath: "/data/pages.duckdb",
          startedAt: expect.any(String),
          version: PAGES_VERSION,
        },
        wikiSettings: { trashRetentionDays: 30 },
      });
    });

    it("asks an administrator in the role mode for the admin mode", async () => {
      useAccount(ROLE_MODE);

      await expect(loader(loaderArguments(createUser()))).resolves.toEqual({
        access: "adminModeRequired",
      });
    });

    it("answers 403 to everyone else", async () => {
      useAccount(createAccess({ isAdmin: false }));

      const failure = await loader(loaderArguments(createUser())).catch(
        (error: unknown) => error,
      );

      expect((failure as Response).status).toBe(403);
    });

    it("throws when the middleware did not provide a user", async () => {
      await expect(loader(loaderArguments(null))).rejects.toThrow(
        "Authenticated middleware did not provide a user.",
      );
    });
  });

  describe("action", () => {
    it("stores the port for an administrator in the admin mode", async () => {
      useAccount(ADMIN_MODE);

      await expect(
        action(actionArguments({ intent: "update-port", port: "8080" })),
      ).resolves.toMatchObject({
        data: { intent: "update-port", ok: true, port: 8080 },
      });
      expect(update).toHaveBeenCalledTimes(1);
    });

    it("refuses the port in the role mode, whatever the form says", async () => {
      useAccount(ROLE_MODE);

      const failure = await action(
        actionArguments({ intent: "update-port", port: "8080" }),
      ).catch((error: unknown) => error);

      expect((failure as Response).status).toBe(403);
      expect(update).not.toHaveBeenCalled();
    });

    it("lets an administrator in the role mode switch to the admin mode", async () => {
      useAccount(ROLE_MODE);

      await expect(
        action(actionArguments({ intent: "set-mode", mode: "admin" })),
      ).resolves.toMatchObject({ data: { intent: "set-mode", ok: true } });
    });

    it("rejects an intent of the personal area", async () => {
      useAccount(ADMIN_MODE);

      const failure = await action(
        actionArguments({ intent: "update-settings" }),
      ).catch((error: unknown) => error);

      expect((failure as Response).status).toBe(400);
    });
  });
});
