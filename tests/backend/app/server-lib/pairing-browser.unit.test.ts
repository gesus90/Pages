import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  pairingBrowserIdentity,
  pairingReturnPath,
} from "@/app/lib/pairing-browser.server";

import {
  EMPLOYEE,
  SYNTHETIC_ORIGIN,
  mustChangePasswordUser,
  sessionCookieHeader,
  thrownResponse,
} from "./request-fixtures";

const authService = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({ authService }),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

function pairRequest(query: string, cookie?: string): Request {
  return new Request(`${SYNTHETIC_ORIGIN}/pair${query}`, {
    headers: cookie === undefined ? {} : { Cookie: cookie },
  });
}

describe("pairingReturnPath", () => {
  it("keeps a code in its normalized form", () => {
    expect(pairingReturnPath(pairRequest("?code=bcdf-ghjk"))).toBe(
      "/pair?code=BCDFGHJK",
    );
    expect(pairingReturnPath(pairRequest("?code=BCDF%20GHJK"))).toBe(
      "/pair?code=BCDFGHJK",
    );
  });

  it.each([
    "",
    "?code=",
    "?code=AEIOUAEI",
    "?code=BCDFGHJ",
    "?code=BCDFGHJKL",
    "?code=//evil.invalid",
    `?code=${"B".repeat(65)}`,
  ])("drops the unusable code in %j", (query) => {
    expect(pairingReturnPath(pairRequest(query))).toBe("/pair");
  });
});

describe("pairingBrowserIdentity", () => {
  it("identifies the user and the browser session", async () => {
    authService.getAuthenticatedUser.mockResolvedValue(EMPLOYEE);
    const cookie = await sessionCookieHeader("token-1");

    expect(
      await pairingBrowserIdentity(pairRequest("?code=BCDFGHJK", cookie)),
    ).toEqual({ userId: EMPLOYEE.id, session: "token-1" });
  });

  it("sends an anonymous browser to the login and back to the code", async () => {
    authService.getAuthenticatedUser.mockResolvedValue(null);

    const response = await thrownResponse(
      pairingBrowserIdentity(pairRequest("?code=bcdfghjk")),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "/login?returnTo=%2Fpair%3Fcode%3DBCDFGHJK",
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("does not let an invalid code reach the login address", async () => {
    authService.getAuthenticatedUser.mockResolvedValue(null);

    const response = await thrownResponse(
      pairingBrowserIdentity(pairRequest("?code=%2F%2Fevil.invalid")),
    );

    expect(response.headers.get("Location")).toBe("/login?returnTo=%2Fpair");
  });

  it("sends a user with a temporary password to the password change", async () => {
    authService.getAuthenticatedUser.mockResolvedValue(
      mustChangePasswordUser(),
    );
    const cookie = await sessionCookieHeader("token-1");

    const response = await thrownResponse(
      pairingBrowserIdentity(pairRequest("?code=BCDFGHJK", cookie)),
    );

    expect(response.headers.get("Location")).toBe(
      "/change-password?returnTo=%2Fpair%3Fcode%3DBCDFGHJK",
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("requires a session token even when a user is returned", async () => {
    authService.getAuthenticatedUser.mockResolvedValue(EMPLOYEE);

    const response = await thrownResponse(
      pairingBrowserIdentity(pairRequest("")),
    );

    expect(response.headers.get("Location")).toBe("/login?returnTo=%2Fpair");
  });
});
