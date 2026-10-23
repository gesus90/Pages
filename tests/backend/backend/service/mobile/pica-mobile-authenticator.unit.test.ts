import { describe, expect, it, vi } from "vitest";

import { TooManyLoginAttemptsError } from "@/backend/auth/LoginThrottle";
import { PagesPicaMobileAuthenticator } from "@/backend/service/mobile/PicaMobileAuthenticator";

import type { AuthService } from "@/backend/auth/AuthService";
import type { User } from "@/definition/User";

const ORIGIN = { clientAddress: "192.168.0.7", userAgent: "okhttp/4" };

const ANNA: User = {
  id: "user-anna",
  username: "anna",
  displayName: "Anna Beispiel",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

function authenticatorFor(service: Partial<AuthService>): {
  readonly authenticator: PagesPicaMobileAuthenticator;
  readonly resolve: ReturnType<typeof vi.fn>;
} {
  const resolve = vi.fn(async () => service as AuthService);

  return { authenticator: new PagesPicaMobileAuthenticator(resolve), resolve };
}

describe("session authentication", () => {
  it("accepts the session of an active account and issues nothing", async () => {
    const { authenticator } = authenticatorFor({
      getAuthenticatedUser: vi.fn(async () => ANNA),
    });

    expect(
      await authenticator.authenticate(
        { method: "session", token: "token-1" },
        ORIGIN,
      ),
    ).toEqual({
      ok: true,
      user: {
        id: "user-anna",
        username: "anna",
        displayName: "Anna Beispiel",
      },
      sessionToken: "token-1",
      isSessionIssued: false,
    });
  });

  it("rejects an unknown or expired session", async () => {
    const { authenticator } = authenticatorFor({
      getAuthenticatedUser: vi.fn(async () => null),
    });

    expect(
      await authenticator.authenticate(
        { method: "session", token: "gone" },
        ORIGIN,
      ),
    ).toEqual({ ok: false, reason: "invalidCredentials" });
  });

  it("refuses an account that has to change its password first", async () => {
    const { authenticator } = authenticatorFor({
      getAuthenticatedUser: vi.fn(async () => ({
        ...ANNA,
        mustChangePassword: true,
      })),
    });

    expect(
      await authenticator.authenticate(
        { method: "session", token: "t" },
        ORIGIN,
      ),
    ).toEqual({ ok: false, reason: "passwordChangeRequired" });
  });
});

describe("password authentication", () => {
  const credentials = {
    method: "password",
    username: "anna",
    password: "pw",
  } as const;

  it("signs in through the Pages login and hands over the new session", async () => {
    const login = vi.fn(async () => ({ user: ANNA, sessionToken: "fresh" }));
    const { authenticator } = authenticatorFor({ login });

    const outcome = await authenticator.authenticate(credentials, ORIGIN);

    expect(login).toHaveBeenCalledWith("anna", "pw", "okhttp/4", "192.168.0.7");
    expect(outcome).toMatchObject({
      ok: true,
      sessionToken: "fresh",
      isSessionIssued: true,
    });
  });

  it("rejects wrong credentials", async () => {
    const { authenticator } = authenticatorFor({ login: vi.fn(async () => null) });

    expect(await authenticator.authenticate(credentials, ORIGIN)).toEqual({
      ok: false,
      reason: "invalidCredentials",
    });
  });

  it("revokes the session of an account that has to change its password", async () => {
    const logout = vi.fn(async () => undefined);
    const { authenticator } = authenticatorFor({
      login: vi.fn(async () => ({
        user: { ...ANNA, mustChangePassword: true },
        sessionToken: "unwanted",
      })),
      logout,
    });

    expect(await authenticator.authenticate(credentials, ORIGIN)).toEqual({
      ok: false,
      reason: "passwordChangeRequired",
    });
    expect(logout).toHaveBeenCalledWith("unwanted");
  });

  it("reports the login throttle with its delay", async () => {
    const { authenticator } = authenticatorFor({
      login: vi.fn(async () => {
        throw new TooManyLoginAttemptsError(42);
      }),
    });

    expect(await authenticator.authenticate(credentials, ORIGIN)).toEqual({
      ok: false,
      reason: "tooManyAttempts",
      retryAfterSeconds: 42,
    });
  });

  it("lets other failures reach the caller", async () => {
    const { authenticator } = authenticatorFor({
      login: vi.fn(async () => {
        throw new Error("database down");
      }),
    });

    await expect(
      authenticator.authenticate(credentials, ORIGIN),
    ).rejects.toThrow("database down");
  });

  it("fails while the services cannot be resolved", async () => {
    const authenticator = new PagesPicaMobileAuthenticator(async () => {
      throw new Error("setup pending");
    });

    await expect(
      authenticator.authenticate(credentials, ORIGIN),
    ).rejects.toThrow("setup pending");
  });
});

describe("session revalidation", () => {
  it.each([
    [ANNA, true],
    [null, false],
    [{ ...ANNA, mustChangePassword: true }, false],
  ])("judges the account %j as active: %s", async (user, expected) => {
    const { authenticator } = authenticatorFor({
      getAuthenticatedUser: vi.fn(async () => user),
    });

    expect(await authenticator.isSessionActive("token")).toBe(expected);
  });
});
