import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import {
  authenticatedUserContext,
  requireAuthenticatedUser,
} from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { loader, middleware } from "@/app/routes/authenticated";
import { PERMISSION, ROLE } from "@/definition/Role";

import type { User } from "@/definition/User";

const mockedGetServices = vi.mocked(getApplicationServices);

function createUser(): User {
  return {
    displayName: "Admin",
    id: "user-1",
    isActive: true,
    role: ROLE.ADMIN,
    username: "admin",
  };
}

function mockPermissions(hasPermission: boolean): void {
  mockedGetServices.mockResolvedValue({
    permissionService: {
      hasPermission: vi.fn().mockReturnValue(hasPermission),
    },
  } as unknown as Awaited<ReturnType<typeof mockedGetServices>>);
}

beforeEach(() => {
  mockPermissions(true);
});

describe("authenticated layout middleware", () => {
  it("protects nested routes with the session middleware", () => {
    expect(middleware).toEqual([requireAuthenticatedUser]);
  });
});

describe("authenticated layout loader", () => {
  it("returns the user stored by the middleware", async () => {
    const user = createUser();
    const context = {
      get: vi.fn().mockReturnValue(user),
    };

    const result = await loader({
      context,
      params: {},
      request: new Request("http://pages.invalid/dashboard"),
    } as unknown as Parameters<typeof loader>[0]);

    expect(context.get).toHaveBeenCalledWith(authenticatedUserContext);
    expect(result).toEqual({ canViewProjects: true, canViewUsers: true, user });
  });

  it("reports missing navigation permissions", async () => {
    mockPermissions(false);
    const user = createUser();
    const context = {
      get: vi.fn().mockReturnValue(user),
    };

    const result = await loader({
      context,
      params: {},
      request: new Request("http://pages.invalid/dashboard"),
    } as unknown as Parameters<typeof loader>[0]);

    expect(result).toEqual({
      canViewProjects: false,
      canViewUsers: false,
      user,
    });
  });

  it("checks the view-users permission of the stored user", async () => {
    const user = createUser();
    const hasPermission = vi.fn().mockReturnValue(true);
    mockedGetServices.mockResolvedValue({
      permissionService: { hasPermission },
    } as unknown as Awaited<ReturnType<typeof mockedGetServices>>);
    const context = {
      get: vi.fn().mockReturnValue(user),
    };

    await loader({
      context,
      params: {},
      request: new Request("http://pages.invalid/dashboard"),
    } as unknown as Parameters<typeof loader>[0]);

    expect(hasPermission).toHaveBeenCalledWith(
      user.role,
      PERMISSION.VIEW_USERS,
    );
    expect(hasPermission).toHaveBeenCalledWith(
      user.role,
      PERMISSION.PARTICIPATE_IN_PROJECTS,
    );
  });

  it("throws when the middleware did not provide a user", async () => {
    const context = {
      get: vi.fn().mockReturnValue(null),
    };

    await expect(
      loader({
        context,
        params: {},
        request: new Request("http://pages.invalid/dashboard"),
      } as unknown as Parameters<typeof loader>[0]),
    ).rejects.toThrow("Authenticated middleware did not provide a user.");
  });
});
