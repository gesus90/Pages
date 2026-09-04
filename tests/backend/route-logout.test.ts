import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { getApplicationServices } from "@/app/lib/services.server";
import {
  destroySessionCookie,
  getSessionToken,
} from "@/app/lib/session.server";
import { action } from "@/app/routes/logout";

const mockedServices = vi.mocked(getApplicationServices);
const mockedToken = vi.mocked(getSessionToken);
const mockedDestroy = vi.mocked(destroySessionCookie);

describe("logout route action", () => {
  beforeEach(() => {
    mockedToken.mockReset();
    mockedServices.mockReset();
    mockedDestroy.mockReset();
  });

  it("rejects non-POST requests", async () => {
    const failure = await action({
      params: {},
      request: new Request("http://pages.invalid/logout"),
    } as unknown as Parameters<typeof action>[0]).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Response);
    expect((failure as Response).status).toBe(405);
    expect((failure as Response).headers.get("Allow")).toBe("POST");
    expect(mockedToken).not.toHaveBeenCalled();
  });

  it("revokes the session and expires its cookie", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    mockedToken.mockResolvedValue("session-token");
    mockedServices.mockResolvedValue({
      authService: { logout },
      sessionService: {},
    } as unknown as Awaited<ReturnType<typeof mockedServices>>);
    mockedDestroy.mockResolvedValue("pages_session=; Max-Age=0");

    const response = await action({
      params: {},
      request: new Request("http://pages.invalid/logout", { method: "POST" }),
    } as unknown as Parameters<typeof action>[0]);

    expect(mockedToken).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledWith("session-token");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login");
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("expires the cookie even without an active token", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    mockedToken.mockResolvedValue(null);
    mockedServices.mockResolvedValue({
      authService: { logout },
      sessionService: {},
    } as unknown as Awaited<ReturnType<typeof mockedServices>>);
    mockedDestroy.mockResolvedValue("pages_session=; Max-Age=0");

    const response = await action({
      params: {},
      request: new Request("http://pages.invalid/logout", { method: "POST" }),
    } as unknown as Parameters<typeof action>[0]);

    expect(logout).toHaveBeenCalledWith(null);
    expect(response.headers.get("Location")).toBe("/login");
  });
});
