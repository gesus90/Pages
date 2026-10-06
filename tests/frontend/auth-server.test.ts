import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/session.server", () => ({
  destroySessionCookie: vi.fn(),
  getSessionToken: vi.fn(),
  sessionCookie: {
    name: "pages_session",
    parse: vi.fn(),
    serialize: vi.fn(),
  },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { RouterContextProvider, redirect } from "react-router";

import {
  authenticatedUserContext,
  getAuthenticatedUser,
  parseCredentials,
  requireAuthenticatedUser,
  requirePermission,
  requireUserManagement,
} from "@/app/lib/auth.server";
import {
  destroySessionCookie,
  getSessionToken,
} from "@/app/lib/session.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { PERMISSION } from "@/definition/Role";

import { createUser } from "../helpers/factories";

import type { User } from "@/definition/User";

const mockedGetSessionToken = vi.mocked(getSessionToken);
const mockedDestroySessionCookie = vi.mocked(destroySessionCookie);
const mockedGetServices = vi.mocked(getApplicationServices);

function createServices(
  user: User | null,
  hasPermission = true,
): Awaited<ReturnType<typeof getApplicationServices>> {
  return {
    authService: {
      getAuthenticatedUser: vi.fn().mockResolvedValue(user),
      login: vi.fn(),
      logout: vi.fn(),
    },
    administrationService: {
      canEnter: vi.fn().mockResolvedValue(hasPermission),
    },
    permissionService: {
      allows: vi.fn().mockReturnValue(hasPermission),
    },
    sessionService: {
      removeExpiredSessions: vi.fn(),
    },
  } as unknown as Awaited<ReturnType<typeof getApplicationServices>>;
}

function createForm(entries: Record<string, string>): FormData {
  const formData = new FormData();

  for (const [key, value] of Object.entries(entries)) {
    formData.append(key, value);
  }

  return formData;
}

describe("parseCredentials", () => {
  it("trims the username while keeping the password unchanged", () => {
    expect(
      parseCredentials(
        createForm({ password: "  secret  ", username: "  admin  " }),
      ),
    ).toEqual({ password: "  secret  ", username: "admin" });
  });

  it("accepts unicode credentials", () => {
    expect(
      parseCredentials(
        createForm({ password: "Müller 🚀", username: "müller" }),
      ),
    ).toEqual({ password: "Müller 🚀", username: "müller" });
  });

  it("rejects missing fields", () => {
    expect(parseCredentials(new FormData())).toBeNull();
    expect(parseCredentials(createForm({ username: "admin" }))).toBeNull();
    expect(parseCredentials(createForm({ password: "secret" }))).toBeNull();
  });

  it("rejects non-string fields", () => {
    const formData = new FormData();
    formData.append("username", new Blob(["admin"]));
    formData.append("password", "secret");

    expect(parseCredentials(formData)).toBeNull();

    const swapped = new FormData();
    swapped.append("username", "admin");
    swapped.append("password", new Blob(["secret"]));

    expect(parseCredentials(swapped)).toBeNull();
  });

  it("rejects empty and whitespace-only values", () => {
    expect(
      parseCredentials(createForm({ password: "secret", username: "" })),
    ).toBeNull();
    expect(
      parseCredentials(createForm({ password: "secret", username: "   " })),
    ).toBeNull();
    expect(
      parseCredentials(createForm({ password: "", username: "admin" })),
    ).toBeNull();
  });

  it("rejects overlong usernames and passwords", () => {
    expect(
      parseCredentials(
        createForm({ password: "secret", username: "a".repeat(201) }),
      ),
    ).toBeNull();
    expect(
      parseCredentials(
        createForm({ password: "p".repeat(1001), username: "admin" }),
      ),
    ).toBeNull();
    expect(
      parseCredentials(
        createForm({
          password: "p".repeat(1001),
          username: "a".repeat(201),
        }),
      ),
    ).toBeNull();
  });

  it("accepts values at the documented length limits", () => {
    const username = "a".repeat(200);
    const password = "p".repeat(1000);

    expect(parseCredentials(createForm({ password, username }))).toEqual({
      password,
      username,
    });
  });
});

describe("getAuthenticatedUser", () => {
  beforeEach(() => {
    mockedGetSessionToken.mockResolvedValue("session-token");
    mockedGetServices.mockResolvedValue(createServices(createUser()));
  });

  it("resolves the user behind the request session", async () => {
    const request = new Request("http://pages.invalid/dashboard");

    await expect(getAuthenticatedUser(request)).resolves.toEqual(createUser());
    expect(mockedGetSessionToken).toHaveBeenCalledWith(request);
  });

  it("returns null when no session token is present", async () => {
    mockedGetSessionToken.mockResolvedValue(null);
    mockedGetServices.mockResolvedValue(createServices(null));

    const request = new Request("http://pages.invalid/dashboard");

    await expect(getAuthenticatedUser(request)).resolves.toBeNull();
  });
});

describe("requireAuthenticatedUser", () => {
  it.each([
    "/dashboard",
    "/users",
    "/settings",
    "/wiki",
    "/tasks",
    "/projekte/p/icon",
    "/users/u/avatar",
  ])(
    "blocks workspace loaders and actions at %s until password replacement",
    async (pathname) => {
      mockedGetServices.mockResolvedValue(
        createServices(createUser({ mustChangePassword: true })),
      );
      const next = vi.fn();
      const failure = await Promise.resolve(
        requireAuthenticatedUser(
          {
            context: { get: vi.fn(), set: vi.fn() },
            params: {},
            request: new Request(`http://pages.invalid${pathname}`, {
              method: "POST",
            }),
          } as unknown as Parameters<typeof requireAuthenticatedUser>[0],
          next,
        ),
      ).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Response);
      expect((failure as Response).headers.get("Location")).toBe(
        "/change-password",
      );
      expect(next).not.toHaveBeenCalled();
    },
  );
  beforeEach(() => {
    mockedGetSessionToken.mockResolvedValue("session-token");
  });

  it("stores the user in the route context and continues", async () => {
    const user = createUser();
    mockedGetServices.mockResolvedValue(createServices(user));
    const stored = new Map<unknown, unknown>();
    const context = {
      get: (key: unknown) => stored.get(key),
      set: (key: unknown, value: unknown) => {
        stored.set(key, value);
      },
    };
    const next = vi.fn().mockResolvedValue("downstream");

    const result = await requireAuthenticatedUser(
      {
        context,
        params: {},
        request: new Request("http://pages.invalid/dashboard"),
      } as unknown as Parameters<typeof requireAuthenticatedUser>[0],
      next,
    );

    expect(result).toBe("downstream");
    expect(stored.get(authenticatedUserContext)).toEqual(user);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("redirects anonymous visitors to the login screen", async () => {
    mockedGetServices.mockResolvedValue(createServices(null));
    const next = vi.fn();
    let failure: unknown;

    try {
      await requireAuthenticatedUser(
        {
          context: { get: vi.fn(), set: vi.fn() },
          params: {},
          request: new Request("http://pages.invalid/dashboard"),
        } as unknown as Parameters<typeof requireAuthenticatedUser>[0],
        next,
      );
    } catch (error: unknown) {
      failure = error;
    }

    expect(next).not.toHaveBeenCalled();
    expect(failure).toBeInstanceOf(Response);
    expect((failure as unknown as Response).status).toBe(302);
    expect((failure as unknown as Response).headers.get("Location")).toBe(
      "/login",
    );
    expect(redirect).toBeDefined();
  });

  it("removes the stale session cookie while redirecting", async () => {
    mockedGetServices.mockResolvedValue(createServices(null));
    mockedDestroySessionCookie.mockResolvedValue(
      "pages_session=; Max-Age=0; Path=/",
    );
    const next = vi.fn();
    let failure: unknown;

    try {
      await requireAuthenticatedUser(
        {
          context: { get: vi.fn(), set: vi.fn() },
          params: {},
          request: new Request("http://pages.invalid/dashboard"),
        } as unknown as Parameters<typeof requireAuthenticatedUser>[0],
        next,
      );
    } catch (error: unknown) {
      failure = error;
    }

    expect((failure as unknown as Response).headers.get("Set-Cookie")).toBe(
      "pages_session=; Max-Age=0; Path=/",
    );
  });
});

describe("requirePermission", () => {
  it("does not let a permission bypass a mandatory password replacement", async () => {
    const user = createUser({ mustChangePassword: true });
    mockedGetServices.mockResolvedValue(createServices(user));
    const { context } = createContext(user);
    const next = vi.fn();
    const failure = await Promise.resolve(
      requirePermission(PERMISSION.VIEW_USERS)(
        {
          context,
          params: {},
          request: new Request("http://pages.invalid/users"),
        } as unknown as Parameters<ReturnType<typeof requirePermission>>[0],
        next,
      ),
    ).catch((error: unknown) => error);
    expect((failure as Response).headers.get("Location")).toBe(
      "/change-password",
    );
    expect(next).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    mockedGetSessionToken.mockResolvedValue("session-token");
  });

  function createContext(user: User | null): {
    context: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
    };
    stored: Map<unknown, unknown>;
  } {
    const stored = new Map<unknown, unknown>();

    if (user) {
      stored.set(authenticatedUserContext, user);
    }

    return {
      context: {
        get: vi.fn((key: unknown) => stored.get(key)),
        set: vi.fn((key: unknown, value: unknown) => {
          stored.set(key, value);
        }),
      },
      stored,
    };
  }

  it("continues when the context user holds the permission", async () => {
    const user = createUser();
    mockedGetServices.mockResolvedValue(createServices(user, true));
    const { context, stored } = createContext(user);
    const next = vi.fn().mockResolvedValue("downstream");

    const result = await requirePermission(PERMISSION.VIEW_USERS)(
      {
        context,
        params: {},
        request: new Request("http://pages.invalid/users"),
      } as unknown as Parameters<ReturnType<typeof requirePermission>>[0],
      next,
    );

    expect(result).toBe("downstream");
    expect(stored.get(authenticatedUserContext)).toEqual(user);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("resolves the user from the request when the context is empty", async () => {
    const user = createUser();
    mockedGetServices.mockResolvedValue(createServices(user, true));
    const { context } = createContext(null);
    const next = vi.fn().mockResolvedValue("downstream");

    const result = await requirePermission(PERMISSION.VIEW_USERS)(
      {
        context,
        params: {},
        request: new Request("http://pages.invalid/users"),
      } as unknown as Parameters<ReturnType<typeof requirePermission>>[0],
      next,
    );

    expect(result).toBe("downstream");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("redirects anonymous visitors to the login screen", async () => {
    mockedGetServices.mockResolvedValue(createServices(null));
    const { context } = createContext(null);
    const next = vi.fn();
    let failure: unknown;

    try {
      await requirePermission(PERMISSION.VIEW_USERS)(
        {
          context,
          params: {},
          request: new Request("http://pages.invalid/users"),
        } as unknown as Parameters<ReturnType<typeof requirePermission>>[0],
        next,
      );
    } catch (error: unknown) {
      failure = error;
    }

    expect(next).not.toHaveBeenCalled();
    expect(failure).toBeInstanceOf(Response);
    expect((failure as unknown as Response).status).toBe(302);
    expect((failure as unknown as Response).headers.get("Location")).toBe(
      "/login",
    );
  });

  it("rejects authenticated users without the permission", async () => {
    const user = createUser();
    mockedGetServices.mockResolvedValue(createServices(user, false));
    const { context } = createContext(user);
    const next = vi.fn();
    let failure: unknown;

    try {
      await requirePermission(PERMISSION.MANAGE_APPLICATION)(
        {
          context,
          params: {},
          request: new Request("http://pages.invalid/users"),
        } as unknown as Parameters<ReturnType<typeof requirePermission>>[0],
        next,
      );
    } catch (error: unknown) {
      failure = error;
    }

    expect(next).not.toHaveBeenCalled();
    expect(failure).toBeInstanceOf(Response);
    expect((failure as unknown as Response).status).toBe(403);
  });
});

describe("requireUserManagement", () => {
  it.each([
    {
      user: null,
      permitted: false,
      stored: false,
      status: 302,
      location: "/login",
    },
    {
      user: createUser({ mustChangePassword: true }),
      permitted: true,
      stored: true,
      status: 302,
      location: "/change-password",
    },
    {
      user: createUser(),
      permitted: false,
      stored: true,
      status: 403,
      location: null,
    },
  ])(
    "rejects an ineligible management request %j",
    async ({ user, permitted, stored, status, location }) => {
      mockedGetServices.mockResolvedValue(createServices(user, permitted));
      const context = new RouterContextProvider();
      if (stored) context.set(authenticatedUserContext, user);
      const next = vi.fn();
      const failure = await Promise.resolve(
        requireUserManagement(
          {
            context,
            params: {},
            request: new Request("http://pages.invalid/users"),
            url: new URL("http://pages.invalid/users"),
            pattern: "/users",
          },
          next,
        ),
      ).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Response);
      if (!(failure instanceof Response))
        throw new Error("Expected middleware rejection");
      expect(failure.status).toBe(status);
      expect(failure.headers.get("Location")).toBe(location);
      expect(next).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    "authorizes identity using current policies with cached context %s",
    async (stored) => {
      const user = createUser();
      mockedGetServices.mockResolvedValue(createServices(user));
      const context = new RouterContextProvider();
      if (stored) context.set(authenticatedUserContext, user);
      const next = vi.fn().mockResolvedValue("permitted");
      expect(
        await requireUserManagement(
          {
            context,
            params: {},
            request: new Request("http://pages.invalid/users"),
            url: new URL("http://pages.invalid/users"),
            pattern: "/users",
          },
          next,
        ),
      ).toBe("permitted");
      expect(context.get(authenticatedUserContext)).toEqual(user);
    },
  );
});
