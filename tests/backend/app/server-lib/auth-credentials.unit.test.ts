import { describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser, parseCredentials } from "@/app/lib/auth.server";

import {
  EMPLOYEE,
  SYNTHETIC_ORIGIN,
  sessionCookieHeader,
} from "./request-fixtures";

const authService = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({ authService }),
}));

function loginForm(fields: Record<string, string | File>): FormData {
  const form = new FormData();

  for (const [name, value] of Object.entries(fields)) {
    form.set(name, value);
  }

  return form;
}

describe("parseCredentials", () => {
  it("accepts a username and a password", () => {
    expect(
      parseCredentials(loginForm({ username: "anna", password: "secret" })),
    ).toEqual({ username: "anna", password: "secret" });
  });

  it("trims the username but keeps the password untouched", () => {
    expect(
      parseCredentials(loginForm({ username: "  anna ", password: " pw " })),
    ).toEqual({ username: "anna", password: " pw " });
  });

  it.each([
    ["no fields", {}],
    ["no password", { username: "anna" }],
    ["no username", { password: "secret" }],
    ["a blank username", { username: "   ", password: "secret" }],
    ["an empty password", { username: "anna", password: "" }],
    [
      "a file as username",
      { username: new File(["anna"], "anna.txt"), password: "secret" },
    ],
  ])("rejects %s", (caseName, fields) => {
    expect(parseCredentials(loginForm(fields))).toBeNull();
  });

  it("limits the length of username and password", () => {
    const longest = { username: "u".repeat(200), password: "p".repeat(1000) };

    expect(parseCredentials(loginForm(longest))).toEqual(longest);
    expect(
      parseCredentials(loginForm({ ...longest, username: "u".repeat(201) })),
    ).toBeNull();
    expect(
      parseCredentials(loginForm({ ...longest, password: "p".repeat(1001) })),
    ).toBeNull();
  });
});

describe("getAuthenticatedUser", () => {
  it("resolves the user of the session token in the cookie", async () => {
    authService.getAuthenticatedUser.mockResolvedValue(EMPLOYEE);
    const request = new Request(SYNTHETIC_ORIGIN, {
      headers: { Cookie: await sessionCookieHeader("token-1") },
    });

    expect(await getAuthenticatedUser(request)).toBe(EMPLOYEE);
    expect(authService.getAuthenticatedUser).toHaveBeenCalledWith("token-1");
  });

  it("asks the service with no token when the request has no session", async () => {
    authService.getAuthenticatedUser.mockReset();
    authService.getAuthenticatedUser.mockResolvedValue(null);

    expect(
      await getAuthenticatedUser(new Request(SYNTHETIC_ORIGIN)),
    ).toBeNull();
    expect(authService.getAuthenticatedUser).toHaveBeenCalledWith(null);
  });
});
