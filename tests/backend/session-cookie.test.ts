import { describe, expect, it, vi } from "vitest";

import {
  destroySessionCookie,
  getSessionToken,
  sessionCookie,
} from "@/app/lib/session.server";
import { SESSION_LIFETIME_SECONDS } from "@/backend/auth/SessionService";

function createRequest(cookieHeader: string | null): Request {
  const headers = new Headers();

  if (cookieHeader !== null) {
    headers.set("Cookie", cookieHeader);
  }

  return new Request("http://pages.invalid/dashboard", { headers });
}

describe("sessionCookie", () => {
  it("is configured as a persistent HttpOnly Lax cookie", () => {
    expect(sessionCookie.name).toBe("pages_session");
  });

  it("serializes tokens with the session lifetime", async () => {
    const header = await sessionCookie.serialize("token-value");

    expect(header).toContain("pages_session=");
    expect(header).toContain(`Max-Age=${SESSION_LIFETIME_SECONDS}`);
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
  });
});

describe("getSessionToken", () => {
  it("returns the token from a valid cookie header", async () => {
    const header = await sessionCookie.serialize("session-token");
    const cookieHeader = header.split(";")[0] ?? "";

    await expect(getSessionToken(createRequest(cookieHeader))).resolves.toBe(
      "session-token",
    );
  });

  it("returns null when no cookie header is present", async () => {
    await expect(getSessionToken(createRequest(null))).resolves.toBeNull();
  });

  it("returns null for an unrelated cookie", async () => {
    await expect(
      getSessionToken(createRequest("other=value")),
    ).resolves.toBeNull();
  });

  it("returns null when the cookie holds a non-string value", async () => {
    const header = await sessionCookie.serialize({
      token: "nested",
    } as unknown as string);
    const cookieHeader = header.split(";")[0] ?? "";

    await expect(
      getSessionToken(createRequest(cookieHeader)),
    ).resolves.toBeNull();
  });

  it("returns null when cookie parsing throws", async () => {
    const parse = vi
      .spyOn(sessionCookie, "parse")
      .mockRejectedValueOnce(new Error("Cookie broken"));

    await expect(
      getSessionToken(createRequest("pages_session=broken")),
    ).resolves.toBeNull();

    expect(parse).toHaveBeenCalledTimes(1);
  });
});

describe("destroySessionCookie", () => {
  it("creates an immediately expired cookie", async () => {
    const header = await destroySessionCookie();

    expect(header).toContain("pages_session=");
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
  });
});
