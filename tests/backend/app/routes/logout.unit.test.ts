import { beforeEach, expect, it, vi } from "vitest";

import {
  destroySessionCookie,
  getSessionToken,
} from "@/app/lib/session.server";
import { action } from "@/app/routes/logout";

import { pagesRequest, responseOf, routeArguments } from "./route-fixture";

const logout = vi.hoisted(() => vi.fn());

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => ({
    authService: { logout },
  }),
}));
vi.mock("@/app/lib/session.server", () => ({
  destroySessionCookie: vi.fn(),
  getSessionToken: vi.fn(),
}));

beforeEach(() => {
  logout.mockReset();
  vi.mocked(getSessionToken).mockResolvedValue("token-1");
  vi.mocked(destroySessionCookie).mockResolvedValue("session=; Max-Age=0");
});

it("accepts only posts", async () => {
  const response = await responseOf(
    action(routeArguments(pagesRequest("/logout"))),
  );

  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("POST");
  expect(logout).not.toHaveBeenCalled();
});

it("revokes the session and clears its cookie", async () => {
  const response = await responseOf(
    action(routeArguments(pagesRequest("/logout", { method: "POST" }))),
  );

  expect(logout).toHaveBeenCalledWith("token-1");
  expect(response.headers.get("Location")).toBe("/login");
  expect(response.headers.get("Set-Cookie")).toBe("session=; Max-Age=0");
});
