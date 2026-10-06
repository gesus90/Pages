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

vi.mock("@/app/lib/language.server", () => ({
  languageCookie: {
    parse: vi.fn(),
    serialize: vi.fn(),
  },
  resolveAnonymousLanguage: vi.fn(),
}));

import { getAuthenticatedUser, parseCredentials } from "@/app/lib/auth.server";
import { resolveAnonymousLanguage } from "@/app/lib/language.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { sessionCookie } from "@/app/lib/session.server";
import { TooManyLoginAttemptsError } from "@/backend/auth/LoginThrottle";
import { action, loader } from "@/app/routes/login";
import { LANGUAGE } from "@/language/Language";

import { createUser } from "../helpers/factories";

const mockedGetUser = vi.mocked(getAuthenticatedUser);
const mockedParse = vi.mocked(parseCredentials);
const mockedServices = vi.mocked(getApplicationServices);
const mockedSerialize = vi.mocked(sessionCookie.serialize);
const mockedLanguage = vi.mocked(resolveAnonymousLanguage);

function createPostRequest(userAgent?: string, forwardedFor?: string): Request {
  const headers = new Headers({
    "Content-Type": "application/x-www-form-urlencoded",
  });

  if (userAgent) {
    headers.set("User-Agent", userAgent);
  }

  if (forwardedFor) {
    headers.set("X-Forwarded-For", forwardedFor);
  }

  return new Request("http://pages.invalid/login", {
    body: new URLSearchParams({ password: "secret", username: "admin" }),
    headers,
    method: "POST",
  });
}

describe("login route loader", () => {
  beforeEach(() => {
    mockedGetUser.mockReset();
    mockedLanguage.mockReset();
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

  it("returns the anonymous language for visitors without a session", async () => {
    mockedGetUser.mockResolvedValue(null);
    mockedLanguage.mockResolvedValue(LANGUAGE.GERMAN);

    const request = new Request("http://pages.invalid/login");

    await expect(
      loader({
        params: {},
        request,
      } as unknown as Parameters<typeof loader>[0]),
    ).resolves.toEqual({ language: LANGUAGE.GERMAN });
    expect(mockedLanguage).toHaveBeenCalledWith(request);
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
      request: createPostRequest("Mozilla/5.0 Firefox/130.0"),
    } as unknown as Parameters<typeof action>[0])) as Response;

    expect(login).toHaveBeenCalledWith(
      "admin",
      "secret",
      "Mozilla/5.0 Firefox/130.0",
      null,
    );
    expect(mockedSerialize).toHaveBeenCalledWith("token", { secure: false });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/dashboard");
    expect(response.headers.get("Set-Cookie")).toContain("pages_session=token");
  });
  it("passes the client address reported by a proxy to the login", async () => {
    const login = vi.fn().mockResolvedValue(null);
    mockedParse.mockReturnValue({ password: "secret", username: "admin" });
    mockedServices.mockResolvedValue({
      authService: { login },
      sessionService: {},
    } as unknown as Awaited<ReturnType<typeof mockedServices>>);

    await action({
      params: {},
      request: createPostRequest("Mozilla/5.0", "203.0.113.7, 10.0.0.1"),
    } as unknown as Parameters<typeof action>[0]);

    expect(login).toHaveBeenCalledWith(
      "admin",
      "secret",
      "Mozilla/5.0",
      "203.0.113.7",
    );
  });

  it("answers throttled attempts with 429 and a retry hint", async () => {
    const login = vi.fn().mockRejectedValue(new TooManyLoginAttemptsError(840));
    mockedParse.mockReturnValue({ password: "secret", username: "admin" });
    mockedServices.mockResolvedValue({
      authService: { login },
      sessionService: {},
    } as unknown as Awaited<ReturnType<typeof mockedServices>>);

    const result = (await action({
      params: {},
      request: createPostRequest(),
    } as unknown as Parameters<typeof action>[0])) as unknown as {
      data: { error: string };
      init?: { headers?: Record<string, string>; status?: number };
    };

    expect(result.init?.status).toBe(429);
    expect(result.init?.headers?.["Retry-After"]).toBe("840");
    expect(result.data).toEqual({ error: "tooManyAttempts" });
    expect(mockedSerialize).not.toHaveBeenCalled();
  });

  it("rethrows unexpected login failures", async () => {
    const login = vi.fn().mockRejectedValue(new Error("Database unavailable"));
    mockedParse.mockReturnValue({ password: "secret", username: "admin" });
    mockedServices.mockResolvedValue({
      authService: { login },
      sessionService: {},
    } as unknown as Awaited<ReturnType<typeof mockedServices>>);

    await expect(
      action({
        params: {},
        request: createPostRequest(),
      } as unknown as Parameters<typeof action>[0]),
    ).rejects.toThrow("Database unavailable");
  });
});
