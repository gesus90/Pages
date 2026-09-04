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

import { redirect } from "react-router";

import {
  authenticatedUserContext,
  getAuthenticatedUser,
  parseCredentials,
  requireAuthenticatedUser,
} from "@/app/lib/auth.server";
import { getSessionToken } from "@/app/lib/session.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { User } from "@/definition/User";

const mockedGetSessionToken = vi.mocked(getSessionToken);
const mockedGetServices = vi.mocked(getApplicationServices);

function createUser(): User {
  return { displayName: "Admin", id: "user-1", username: "admin" };
}

function createServices(
  user: User | null,
): Awaited<ReturnType<typeof getApplicationServices>> {
  return {
    authService: {
      getAuthenticatedUser: vi.fn().mockResolvedValue(user),
      login: vi.fn(),
      logout: vi.fn(),
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
});
