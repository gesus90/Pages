import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/auth.server", () => ({
  authenticatedUserContext: {},
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { getApplicationServices } from "@/app/lib/services.server";
import { loader } from "@/app/routes/settings";
import { loader as redirectToProfile } from "@/app/routes/settings-index";

import { createAccess } from "../helpers/authorization";
import { createUser } from "../helpers/factories";

import type { AccountAccess } from "@/definition/Authorization";
import type { User } from "@/definition/User";

function createArguments(user: User | null): Parameters<typeof loader>[0] {
  return {
    context: { get: vi.fn().mockReturnValue(user) },
    params: {},
    request: new Request("http://pages.invalid/settings"),
  } as unknown as Parameters<typeof loader>[0];
}

function useAccount(account: AccountAccess): void {
  vi.mocked(getApplicationServices).mockResolvedValue({
    administrationService: { getContext: vi.fn().mockResolvedValue(account) },
  } as unknown as Awaited<ReturnType<typeof getApplicationServices>>);
}

describe("settings layout loader", () => {
  beforeEach(() => {
    vi.mocked(getApplicationServices).mockReset();
  });

  it.each([
    ["an admin in the admin mode", { isAdmin: true, mode: "admin" }, true],
    ["an admin in the role mode", { isAdmin: true, mode: "role" }, false],
    ["an account without the admin permission", { isAdmin: false }, false],
  ] as const)(
    "lists the admin areas for %s: %s",
    async (_name, overrides, expected) => {
      useAccount(createAccess(overrides));

      await expect(loader(createArguments(createUser()))).resolves.toEqual({
        canViewSystem: expected,
      });
    },
  );

  it("throws when the middleware did not provide a user", async () => {
    await expect(loader(createArguments(null))).rejects.toThrow(
      "Authenticated middleware did not provide a user.",
    );
  });
});

describe("settings index", () => {
  it("redirects to the personal area", () => {
    const response = redirectToProfile();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/settings/profile");
  });
});
