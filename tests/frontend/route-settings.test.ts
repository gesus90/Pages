import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/auth.server", () => ({
  authenticatedUserContext: {},
  getAuthenticatedUser: vi.fn(),
  parseCredentials: vi.fn(),
  requireAuthenticatedUser: vi.fn(),
  requirePermission: vi.fn(),
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: vi.fn(),
}));

import { getApplicationServices } from "@/app/lib/services.server";
import { action, loader } from "@/app/routes/settings";
import { PermissionService } from "@/backend/auth/PermissionService";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";

import type { PagesRuntime } from "@/backend/runtime/PagesRuntime";

import { DEFAULT_USER_SETTINGS } from "@/definition/Settings";

import type { User } from "@/definition/User";

const mockedServices = vi.mocked(getApplicationServices);

function createUser(role: User["role"] = "admin"): User {
  return {
    displayName: "Admin",
    id: "user-1",
    isActive: true,
    role,
    username: "admin",
  };
}

function createServices(
  overrides: Record<string, unknown> = {},
): Awaited<ReturnType<typeof mockedServices>> {
  return {
    permissionService: new PermissionService(),
    sessionService: {
      getSessionSummaries: vi.fn().mockResolvedValue([]),
    },
    settingsService: {
      getUserSettings: vi.fn().mockResolvedValue(DEFAULT_USER_SETTINGS),
      updateSettings: vi.fn().mockResolvedValue(undefined),
    },
    userService: {
      findProfileEmail: vi.fn().mockResolvedValue("admin@example.invalid"),
    },
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof mockedServices>>;
}

function createSettingsEntries(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    dateFormat: "DD.MM.YYYY",
    intent: "update-settings",
    language: "en",
    "notification.assignments": "on",
    "notification.desktop": "off",
    "notification.dueDates": "on",
    "notification.email": "on",
    "notification.mentions": "on",
    "notification.weeklySummary": "off",
    timezone: "",
    weekStart: "monday",
    ...overrides,
  };
}

function createContext(user: User | null): {
  get: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn().mockReturnValue(user),
  };
}

function createPostRequest(entries: Record<string, string>): Request {
  return new Request("http://pages.invalid/settings", {
    body: new URLSearchParams(entries),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
}

describe("settings route loader", () => {
  beforeEach(() => {
    mockedServices.mockReset();
    vi.mocked(getPagesRuntime).mockResolvedValue({
      configFile: {
        read: vi.fn().mockResolvedValue({
          databasePath: "/data/pages.duckdb",
          firstRun: false,
          port: 4100,
        }),
      },
    } as unknown as PagesRuntime);
  });

  it("returns the stored settings and profile of the authenticated user", async () => {
    const stored = { ...DEFAULT_USER_SETTINGS, language: "en" as const };
    mockedServices.mockResolvedValue(
      createServices({
        settingsService: { getUserSettings: vi.fn().mockResolvedValue(stored) },
      }),
    );
    const user = createUser();

    const result = await loader({
      context: createContext(user),
      params: {},
      request: new Request("http://pages.invalid/settings"),
    } as unknown as Parameters<typeof loader>[0]);

    expect(result).toEqual({
      assignableRoles: ["admin", "manager", "employee"],
      canEditProfile: true,
      email: "admin@example.invalid",
      serverPort: 4100,
      sessions: [],
      settings: stored,
      user,
    });
  });

  it("keeps the profile read-only for non-administrators", async () => {
    mockedServices.mockResolvedValue(createServices());

    const result = await loader({
      context: createContext(createUser("employee")),
      params: {},
      request: new Request("http://pages.invalid/settings"),
    } as unknown as Parameters<typeof loader>[0]);

    expect(result.canEditProfile).toBe(false);
    expect(result.assignableRoles).toEqual([]);
    expect(result.serverPort).toBeNull();
  });

  it("throws when the middleware did not provide a user", async () => {
    await expect(
      loader({
        context: createContext(null),
        params: {},
        request: new Request("http://pages.invalid/settings"),
      } as unknown as Parameters<typeof loader>[0]),
    ).rejects.toThrow("Authenticated middleware did not provide a user.");
  });

  it("reads the settings, email, and sessions of the stored user", async () => {
    const getUserSettings = vi.fn().mockResolvedValue(DEFAULT_USER_SETTINGS);
    const findProfileEmail = vi.fn().mockResolvedValue(null);
    const getSessionSummaries = vi.fn().mockResolvedValue([]);
    mockedServices.mockResolvedValue(
      createServices({
        sessionService: { getSessionSummaries },
        settingsService: { getUserSettings },
        userService: { findProfileEmail },
      }),
    );
    const user = createUser();

    await loader({
      context: createContext(user),
      params: {},
      request: new Request("http://pages.invalid/settings"),
    } as unknown as Parameters<typeof loader>[0]);

    expect(getUserSettings).toHaveBeenCalledWith(user.id);
    expect(findProfileEmail).toHaveBeenCalledWith(user.id);
    expect(getSessionSummaries).toHaveBeenCalledWith(user.id, null);
  });
});

describe("settings route action", () => {
  beforeEach(() => {
    mockedServices.mockReset();
  });

  it("rejects non-POST requests", async () => {
    const failure = await action({
      context: createContext(createUser()),
      params: {},
      request: new Request("http://pages.invalid/settings"),
    } as unknown as Parameters<typeof action>[0]).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Response);
    expect((failure as Response).status).toBe(405);
    expect((failure as Response).headers.get("Allow")).toBe("POST");
  });

  it("rejects anonymous visitors", async () => {
    const failure = await action({
      context: createContext(null),
      params: {},
      request: createPostRequest(createSettingsEntries()),
    } as unknown as Parameters<typeof action>[0]).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Response);
    expect((failure as Response).status).toBe(403);
  });

  it("rejects unsupported languages", async () => {
    mockedServices.mockResolvedValue(createServices());

    const failure = await action({
      context: createContext(createUser()),
      params: {},
      request: createPostRequest(createSettingsEntries({ language: "fr" })),
    } as unknown as Parameters<typeof action>[0]).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Response);
    expect((failure as Response).status).toBe(400);
  });

  it("rejects settings forms with a missing notification choice", async () => {
    mockedServices.mockResolvedValue(createServices());
    const entries = createSettingsEntries();
    delete entries["notification.email"];

    const failure = await action({
      context: createContext(createUser()),
      params: {},
      request: createPostRequest(entries),
    } as unknown as Parameters<typeof action>[0]).catch(
      (error: unknown) => error,
    );

    expect((failure as Response).status).toBe(400);
  });

  it("rejects unknown intents", async () => {
    mockedServices.mockResolvedValue(createServices());

    const failure = await action({
      context: createContext(createUser()),
      params: {},
      request: createPostRequest({ intent: "delete-everything" }),
    } as unknown as Parameters<typeof action>[0]).catch(
      (error: unknown) => error,
    );

    expect((failure as Response).status).toBe(400);
  });

  it("persists supported settings selections", async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    mockedServices.mockResolvedValue(
      createServices({ settingsService: { updateSettings } }),
    );
    const user = createUser();

    const result = await action({
      context: createContext(user),
      params: {},
      request: createPostRequest(createSettingsEntries()),
    } as unknown as Parameters<typeof action>[0]);

    expect(updateSettings).toHaveBeenCalledWith(user.id, {
      dateFormat: "DD.MM.YYYY",
      language: "en",
      notifications: {
        assignments: true,
        desktop: false,
        dueDates: true,
        email: true,
        mentions: true,
        weeklySummary: false,
      },
      timezone: null,
      weekStart: "monday",
    });
    expect(result).toBeNull();
  });

  it("restricts profile edits to administrators", async () => {
    mockedServices.mockResolvedValue(createServices());

    const failure = await action({
      context: createContext(createUser("employee")),
      params: {},
      request: createPostRequest({
        displayName: "Mallory",
        intent: "update-profile",
        role: "admin",
        username: "mallory",
      }),
    } as unknown as Parameters<typeof action>[0]).catch(
      (error: unknown) => error,
    );

    expect((failure as Response).status).toBe(403);
  });
});
