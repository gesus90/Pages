import { describe, expect, it, vi } from "vitest";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { loader } from "@/app/routes/dashboard";

import type { User } from "@/definition/User";

function createUser(displayName = "Admin"): User {
  return { displayName, id: "user-1", username: "admin" };
}

describe("dashboard route loader", () => {
  it("returns the display name and current hour", () => {
    const context = {
      get: vi.fn().mockReturnValue(createUser("Müller 🚀")),
    };

    const result = loader({
      context,
      params: {},
      request: new Request("http://pages.invalid/dashboard"),
    } as unknown as Parameters<typeof loader>[0]);

    expect(context.get).toHaveBeenCalledWith(authenticatedUserContext);
    expect(result.displayName).toBe("Müller 🚀");
    expect(Number.isInteger(result.hour)).toBe(true);
    expect(result.hour).toBeGreaterThanOrEqual(0);
    expect(result.hour).toBeLessThanOrEqual(23);
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
