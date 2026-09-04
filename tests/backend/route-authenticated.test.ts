import { describe, expect, it, vi } from "vitest";

import {
  authenticatedUserContext,
  requireAuthenticatedUser,
} from "@/app/lib/auth.server";
import { loader, middleware } from "@/app/routes/authenticated";

import type { User } from "@/definition/User";

function createUser(): User {
  return { displayName: "Admin", id: "user-1", username: "admin" };
}

describe("authenticated layout middleware", () => {
  it("protects nested routes with the session middleware", () => {
    expect(middleware).toEqual([requireAuthenticatedUser]);
  });
});

describe("authenticated layout loader", () => {
  it("returns the user stored by the middleware", () => {
    const user = createUser();
    const context = {
      get: vi.fn().mockReturnValue(user),
    };

    const result = loader({
      context,
      params: {},
      request: new Request("http://pages.invalid/dashboard"),
    } as unknown as Parameters<typeof loader>[0]);

    expect(context.get).toHaveBeenCalledWith(authenticatedUserContext);
    expect(result).toEqual({ user });
  });

  it("throws when the middleware did not provide a user", () => {
    const context = {
      get: vi.fn().mockReturnValue(null),
    };

    expect(() =>
      loader({
        context,
        params: {},
        request: new Request("http://pages.invalid/dashboard"),
      } as unknown as Parameters<typeof loader>[0]),
    ).toThrow("Authenticated middleware did not provide a user.");
  });
});
