import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/auth.server", () => ({
  authenticatedUserContext: {},
  getAuthenticatedUser: vi.fn(),
  parseCredentials: vi.fn(),
  requireAuthenticatedUser: vi.fn(),
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

vi.mock("@/app/lib/session.server", () => ({
  destroySessionCookie: vi.fn(),
  getSessionToken: vi.fn(),
  sessionCookie: {
    serialize: vi.fn(),
  },
}));

import { getAuthenticatedUser, parseCredentials } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { sessionCookie } from "@/app/lib/session.server";
import { action, loader } from "@/app/routes/login";

import type { User } from "@/definition/User";

const mockedGetUser = vi.mocked(getAuthenticatedUser);
const mockedParse = vi.mocked(parseCredentials);
const mockedServices = vi.mocked(getApplicationServices);
const mockedSerialize = vi.mocked(sessionCookie.serialize);

function createUser(): User {
  return { displayName: "Admin", id: "user-1", username: "admin" };
}

function createPostRequest(): Request {
  return new Request("http://pages.invalid/login", {
    body: new URLSearchParams({ password: "secret", username: "admin" }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
}

describe("login route loader", () => {
  beforeEach(() => {
    mockedGetUser.mockReset();
  });

  it("redirects visitors with an active session", async () => {
    mockedGetUser.mockResolvedValue(createUser());

    const response = await loader({
      params: {},
      request: new Request("http://pages.invalid/login"),
    } as unknown as Parameters<typeof loader>[0]);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toBe("/dashboard");
  });

  it("returns null for anonymous visitors", async () => {
    mockedGetUser.mockResolvedValue(null);

    await expect(
      loader({
        params: {},
        request: new Request("http://pages.invalid/login"),
      } as unknown as Parameters<typeof loader>[0]),
    ).resolves.toBeNull();
  });
});

describe("login route action", () => {
  beforeEach(() => {
    mockedParse.mockReset();
    mockedServices.mockReset();
    mockedSerialize.mockReset();
  });

  it("rejects non-POST requests", async () => {
    const failure = await action({
      params: {},
      request: new Request("http://pages.invalid/login"),
    } as unknown as Parameters<typeof action>[0]).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Response);
    expect((failure as Response).status).toBe(405);
    expect((failure as Response).headers.get("Allow")).toBe("POST");
  });

  it("returns invalid credentials for unparsable forms", async () => {
    mockedParse.mockReturnValue(null);

    const result = (await action({
      params: {},
      request: createPostRequest(),
    } as unknown as Parameters<typeof action>[0])) as unknown as {
      data: { error: string };
      init?: { status?: number };
    };

    expect(result.init?.status).toBe(400);
    expect(result.data).toEqual({ error: "invalidCredentials" });
  });

  it("returns invalid credentials when authentication fails", async () => {
    mockedParse.mockReturnValue({ password: "wrong", username: "admin" });
    mockedServices.mockResolvedValue({
      authService: { login: vi.fn().mockResolvedValue(null) },
      sessionService: {},
    } as unknown as Awaited<ReturnType<typeof mockedServices>>);

    const result = (await action({
      params: {},
      request: createPostRequest(),
    } as unknown as Parameters<typeof action>[0])) as unknown as {
      data: { error: string };
      init?: { status?: number };
    };

    expect(result.init?.status).toBe(401);
    expect(result.data).toEqual({ error: "invalidCredentials" });
  });

  it("creates a session cookie for valid credentials", async () => {
    const user = createUser();
    const login = vi.fn().mockResolvedValue({ sessionToken: "token", user });
    mockedParse.mockReturnValue({ password: "secret", username: "admin" });
    mockedServices.mockResolvedValue({
      authService: { login },
      sessionService: {},
    } as unknown as Awaited<ReturnType<typeof mockedServices>>);
    mockedSerialize.mockResolvedValue("pages_session=token; Path=/");

    const response = (await action({
      params: {},
      request: createPostRequest(),
    } as unknown as Parameters<typeof action>[0])) as Response;

    expect(login).toHaveBeenCalledWith("admin", "secret");
    expect(mockedSerialize).toHaveBeenCalledWith("token");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/dashboard");
    expect(response.headers.get("Set-Cookie")).toContain("pages_session=token");
  });
});
