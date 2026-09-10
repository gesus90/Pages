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

import { getApplicationServices } from "@/app/lib/services.server";
import { action, loader } from "@/app/routes/settings";

import type { User } from "@/definition/User";

const mockedServices = vi.mocked(getApplicationServices);

function createUser(): User {
  return {
    displayName: "Admin",
    id: "user-1",
    isActive: true,
    role: "admin",
    username: "admin",
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
  });

  it("returns the stored language of the authenticated user", async () => {
    mockedServices.mockResolvedValue({
      settingsService: {
        getUserSettings: vi.fn().mockResolvedValue({ language: "en" }),
      },
    } as unknown as Awaited<ReturnType<typeof mockedServices>>);

    const result = await loader({
      context: createContext(createUser()),
      params: {},
      request: new Request("http://pages.invalid/settings"),
    } as unknown as Parameters<typeof loader>[0]);

    expect(result).toEqual({ language: "en" });
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

  it("reads the settings of the stored user", async () => {
    const getUserSettings = vi.fn().mockResolvedValue({ language: "de" });
    mockedServices.mockResolvedValue({
      settingsService: { getUserSettings },
    } as unknown as Awaited<ReturnType<typeof mockedServices>>);
    const user = createUser();

    await loader({
      context: createContext(user),
      params: {},
      request: new Request("http://pages.invalid/settings"),
    } as unknown as Parameters<typeof loader>[0]);

    expect(getUserSettings).toHaveBeenCalledWith(user.id);
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
      request: createPostRequest({ language: "de" }),
    } as unknown as Parameters<typeof action>[0]).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Response);
    expect((failure as Response).status).toBe(403);
  });

  it("rejects unsupported languages", async () => {
    const failure = await action({
      context: createContext(createUser()),
      params: {},
      request: createPostRequest({ language: "fr" }),
    } as unknown as Parameters<typeof action>[0]).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Response);
    expect((failure as Response).status).toBe(400);
  });

  it("persists supported language selections", async () => {
    const updateLanguage = vi.fn().mockResolvedValue(undefined);
    mockedServices.mockResolvedValue({
      settingsService: { updateLanguage },
    } as unknown as Awaited<ReturnType<typeof mockedServices>>);
    const user = createUser();

    const result = await action({
      context: createContext(user),
      params: {},
      request: createPostRequest({ language: "en" }),
    } as unknown as Parameters<typeof action>[0]);

    expect(updateLanguage).toHaveBeenCalledWith(user.id, "en");
    expect(result).toBeNull();
  });
});
