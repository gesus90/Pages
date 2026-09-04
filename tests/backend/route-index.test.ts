import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/auth.server", () => ({
  authenticatedUserContext: {},
  getAuthenticatedUser: vi.fn(),
  parseCredentials: vi.fn(),
  requireAuthenticatedUser: vi.fn(),
}));

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { loader } from "@/app/routes/index";

import type { User } from "@/definition/User";

const mockedGetUser = vi.mocked(getAuthenticatedUser);

function createUser(): User {
  return { displayName: "Admin", id: "user-1", username: "admin" };
}

describe("index route loader", () => {
  beforeEach(() => {
    mockedGetUser.mockReset();
  });

  it("redirects authenticated visitors to the dashboard", async () => {
    mockedGetUser.mockResolvedValue(createUser());

    const response = await loader({
      params: {},
      request: new Request("http://pages.invalid/"),
    } as unknown as Parameters<typeof loader>[0]);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/dashboard");
  });

  it("redirects anonymous visitors to the login screen", async () => {
    mockedGetUser.mockResolvedValue(null);

    const response = await loader({
      params: {},
      request: new Request("http://pages.invalid/"),
    } as unknown as Parameters<typeof loader>[0]);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login");
  });
});
