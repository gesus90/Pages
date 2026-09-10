import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/auth.server", () => ({
  authenticatedUserContext: {},
  getAuthenticatedUser: vi.fn(),
  parseCredentials: vi.fn(),
  requireAuthenticatedUser: vi.fn(),
  requirePermission: vi.fn(),
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { getApplicationServices } from "@/app/lib/services.server";
import { UsernameTakenError } from "@/backend/database/repositories/UserRepository";
import {
  LastAdministratorError,
  RoleAssignmentDeniedError,
  UserManagementDeniedError,
  UserNotFoundError,
} from "@/backend/service/UserService";
import { action, loader, middleware } from "@/app/routes/users";
import { ROLE } from "@/definition/Role";

import type { User } from "@/definition/User";

const mockedServices = vi.mocked(getApplicationServices);

function createUser(overrides: Partial<User> = {}): User {
  return {
    displayName: "Admin",
    id: "user-1",
    isActive: true,
    role: ROLE.ADMIN,
    username: "admin",
    ...overrides,
  };
}

function createServices(
  overrides: Record<string, unknown> = {},
): Awaited<ReturnType<typeof mockedServices>> {
  return {
    passwordHasher: { hash: vi.fn().mockResolvedValue("encoded-hash") },
    permissionService: {
      canManageUser: vi.fn().mockReturnValue(true),
    },
    userService: {
      createUser: vi.fn().mockResolvedValue(undefined),
      findAll: vi.fn().mockResolvedValue([]),
      setActive: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof mockedServices>>;
}

function createPostRequest(entries: Record<string, string>): Request {
  return new Request("http://pages.invalid/users", {
    body: new URLSearchParams(entries),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
}

describe("users route middleware", () => {
  it("is defined for the route module", () => {
    expect(Array.isArray(middleware)).toBe(true);
    expect(middleware).toHaveLength(1);
  });
});

describe("users route loader", () => {
  beforeEach(() => {
    mockedServices.mockReset();
  });

  it("throws when the middleware did not provide a user", async () => {
    await expect(
      loader({
        context: { get: vi.fn().mockReturnValue(null) },
        params: {},
        request: new Request("http://pages.invalid/users"),
      } as unknown as Parameters<typeof loader>[0]),
    ).rejects.toThrow("Authenticated middleware did not provide a user.");
  });

  it("exposes every role to administrators", async () => {
    mockedServices.mockResolvedValue(createServices());
    const actor = createUser({ role: ROLE.ADMIN });

    const result = await loader({
      context: { get: vi.fn().mockReturnValue(actor) },
      params: {},
      request: new Request("http://pages.invalid/users"),
    } as unknown as Parameters<typeof loader>[0]);

    expect(result.assignableRoles).toEqual(["admin", "manager", "employee"]);
  });

  it("exposes only employees to managers", async () => {
    mockedServices.mockResolvedValue(createServices());
    const actor = createUser({ role: ROLE.MANAGER });

    const result = await loader({
      context: { get: vi.fn().mockReturnValue(actor) },
      params: {},
      request: new Request("http://pages.invalid/users"),
    } as unknown as Parameters<typeof loader>[0]);

    expect(result.assignableRoles).toEqual(["employee"]);
  });

  it("marks manageable users for the actor", async () => {
    const canManageUser = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    mockedServices.mockResolvedValue(
      createServices({
        permissionService: { canManageUser },
        userService: {
          findAll: vi
            .fn()
            .mockResolvedValue([
              createUser({ id: "user-2", username: "second" }),
              createUser({ id: "user-3", username: "third" }),
            ]),
        },
      }),
    );
    const actor = createUser();

    const result = await loader({
      context: { get: vi.fn().mockReturnValue(actor) },
      params: {},
      request: new Request("http://pages.invalid/users"),
    } as unknown as Parameters<typeof loader>[0]);

    expect(result.users).toHaveLength(2);
    expect(result.users[0]).toMatchObject({ canManage: true });
    expect(result.users[1]).toMatchObject({ canManage: false });
    expect(canManageUser).toHaveBeenCalledWith(actor.role, "admin");
  });
});

describe("users route action", () => {
  beforeEach(() => {
    mockedServices.mockReset();
  });

  it("rejects non-POST requests", async () => {
    const failure = await action({
      context: { get: vi.fn().mockReturnValue(createUser()) },
      params: {},
      request: new Request("http://pages.invalid/users"),
    } as unknown as Parameters<typeof action>[0]).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Response);
    expect((failure as Response).status).toBe(405);
  });

  it("rejects anonymous visitors", async () => {
    const failure = await action({
      context: { get: vi.fn().mockReturnValue(null) },
      params: {},
      request: createPostRequest({ intent: "create-user" }),
    } as unknown as Parameters<typeof action>[0]).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Response);
    expect((failure as Response).status).toBe(403);
  });

  it("rejects unknown intents", async () => {
    mockedServices.mockResolvedValue(createServices());

    const result = (await action({
      context: { get: vi.fn().mockReturnValue(createUser()) },
      params: {},
      request: createPostRequest({ intent: "rename-user" }),
    } as unknown as Parameters<typeof action>[0])) as unknown as {
      data: Record<string, unknown>;
      init?: { status?: number };
    };

    expect(result.init?.status).toBe(400);
    expect(result.data).toMatchObject({
      error: "invalidInput",
      intent: "create-user",
      ok: false,
    });
  });

  it("creates users with valid input", async () => {
    const createUserMock = vi.fn().mockResolvedValue(undefined);
    const hash = vi.fn().mockResolvedValue("encoded-hash");
    mockedServices.mockResolvedValue(
      createServices({
        passwordHasher: { hash },
        userService: { createUser: createUserMock },
      }),
    );
    const actor = createUser();

    const result = (await action({
      context: { get: vi.fn().mockReturnValue(actor) },
      params: {},
      request: createPostRequest({
        displayName: "Newcomer",
        intent: "create-user",
        password: "long-enough-secret",
        role: "manager",
        username: "newcomer",
      }),
    } as unknown as Parameters<typeof action>[0])) as unknown as {
      data: Record<string, unknown>;
    };

    expect(result.data).toEqual({ intent: "create-user", ok: true });
    expect(hash).toHaveBeenCalledWith("long-enough-secret");
    expect(createUserMock).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        displayName: "Newcomer",
        role: "manager",
        username: "newcomer",
      }),
    );
  });

  it("forces the employee role for non-administrators", async () => {
    const createUserMock = vi.fn().mockResolvedValue(undefined);
    mockedServices.mockResolvedValue(
      createServices({ userService: { createUser: createUserMock } }),
    );
    const actor = createUser({ role: ROLE.MANAGER });

    await action({
      context: { get: vi.fn().mockReturnValue(actor) },
      params: {},
      request: createPostRequest({
        displayName: "Newcomer",
        intent: "create-user",
        password: "long-enough-secret",
        role: "admin",
        username: "newcomer",
      }),
    } as unknown as Parameters<typeof action>[0]);

    expect(createUserMock).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ role: "employee" }),
    );
  });

  it.each([
    ["missing display name", { password: "long-enough-secret", username: "x" }],
    ["missing username", { displayName: "X", password: "long-enough-secret" }],
    ["missing password", { displayName: "X", username: "x" }],
    [
      "short password",
      {
        displayName: "X",
        intent: "create-user",
        password: "short",
        username: "x",
      },
    ],
    [
      "blank names",
      {
        displayName: "   ",
        password: "long-enough-secret",
        username: "   ",
      },
    ],
  ])("rejects user creation with %s", async (_case, entries) => {
    mockedServices.mockResolvedValue(createServices());

    const result = (await action({
      context: { get: vi.fn().mockReturnValue(createUser()) },
      params: {},
      request: createPostRequest({ intent: "create-user", ...entries }),
    } as unknown as Parameters<typeof action>[0])) as unknown as {
      data: Record<string, unknown>;
      init?: { status?: number };
    };

    expect(result.init?.status).toBe(400);
    expect(result.data).toMatchObject({
      error: "invalidInput",
      intent: "create-user",
      ok: false,
    });
  });

  it("rejects overlong user creation values", async () => {
    mockedServices.mockResolvedValue(createServices());

    const result = (await action({
      context: { get: vi.fn().mockReturnValue(createUser()) },
      params: {},
      request: createPostRequest({
        displayName: "a".repeat(201),
        intent: "create-user",
        password: "long-enough-secret",
        username: "newcomer",
      }),
    } as unknown as Parameters<typeof action>[0])) as unknown as {
      data: Record<string, unknown>;
      init?: { status?: number };
    };

    expect(result.init?.status).toBe(400);
    expect(result.data).toMatchObject({ error: "invalidInput" });
  });

  it("reports taken usernames with a conflict", async () => {
    mockedServices.mockResolvedValue(
      createServices({
        userService: {
          createUser: vi.fn().mockRejectedValue(new UsernameTakenError("sam")),
        },
      }),
    );

    const result = (await action({
      context: { get: vi.fn().mockReturnValue(createUser()) },
      params: {},
      request: createPostRequest({
        displayName: "Sam",
        intent: "create-user",
        password: "long-enough-secret",
        username: "sam",
      }),
    } as unknown as Parameters<typeof action>[0])) as unknown as {
      data: Record<string, unknown>;
      init?: { status?: number };
    };

    expect(result.init?.status).toBe(409);
    expect(result.data).toMatchObject({ error: "usernameTaken" });
  });

  it.each([
    ["role assignments", new RoleAssignmentDeniedError()],
    ["user management", new UserManagementDeniedError()],
  ])("forbids user creation beyond %s", async (_case, error) => {
    mockedServices.mockResolvedValue(
      createServices({
        userService: { createUser: vi.fn().mockRejectedValue(error) },
      }),
    );

    const result = (await action({
      context: { get: vi.fn().mockReturnValue(createUser()) },
      params: {},
      request: createPostRequest({
        displayName: "Sam",
        intent: "create-user",
        password: "long-enough-secret",
        username: "sam",
      }),
    } as unknown as Parameters<typeof action>[0])) as unknown as {
      data: Record<string, unknown>;
      init?: { status?: number };
    };

    expect(result.init?.status).toBe(403);
    expect(result.data).toMatchObject({ error: "forbidden" });
  });

  it("rethrows unexpected user creation failures", async () => {
    mockedServices.mockResolvedValue(
      createServices({
        userService: {
          createUser: vi.fn().mockRejectedValue(new Error("Disk broken")),
        },
      }),
    );

    await expect(
      action({
        context: { get: vi.fn().mockReturnValue(createUser()) },
        params: {},
        request: createPostRequest({
          displayName: "Sam",
          intent: "create-user",
          password: "long-enough-secret",
          username: "sam",
        }),
      } as unknown as Parameters<typeof action>[0]),
    ).rejects.toThrow("Disk broken");
  });

  it("toggles the active state of users", async () => {
    const setActive = vi.fn().mockResolvedValue(undefined);
    mockedServices.mockResolvedValue(
      createServices({ userService: { setActive } }),
    );
    const actor = createUser();

    const result = (await action({
      context: { get: vi.fn().mockReturnValue(actor) },
      params: {},
      request: createPostRequest({
        intent: "set-active",
        isActive: "false",
        userId: "user-2",
      }),
    } as unknown as Parameters<typeof action>[0])) as unknown as {
      data: Record<string, unknown>;
    };

    expect(result.data).toEqual({ intent: "set-active", ok: true });
    expect(setActive).toHaveBeenCalledWith(actor, "user-2", false);
  });

  it.each([
    ["missing user id", { intent: "set-active", isActive: "true" }],
    ["missing flag", { intent: "set-active", userId: "user-2" }],
    [
      "unexpected flag",
      { intent: "set-active", isActive: "maybe", userId: "user-2" },
    ],
  ])("rejects state changes with %s", async (_case, entries) => {
    mockedServices.mockResolvedValue(createServices());

    const result = (await action({
      context: { get: vi.fn().mockReturnValue(createUser()) },
      params: {},
      request: createPostRequest(entries),
    } as unknown as Parameters<typeof action>[0])) as unknown as {
      data: Record<string, unknown>;
      init?: { status?: number };
    };

    expect(result.init?.status).toBe(400);
    expect(result.data).toMatchObject({
      error: "invalidInput",
      intent: "set-active",
    });
  });

  it("reports unknown users with a missing response", async () => {
    mockedServices.mockResolvedValue(
      createServices({
        userService: {
          setActive: vi.fn().mockRejectedValue(new UserNotFoundError()),
        },
      }),
    );

    const result = (await action({
      context: { get: vi.fn().mockReturnValue(createUser()) },
      params: {},
      request: createPostRequest({
        intent: "set-active",
        isActive: "true",
        userId: "missing",
      }),
    } as unknown as Parameters<typeof action>[0])) as unknown as {
      data: Record<string, unknown>;
      init?: { status?: number };
    };

    expect(result.init?.status).toBe(404);
    expect(result.data).toMatchObject({ error: "userNotFound" });
  });

  it("protects the last administrator with a conflict", async () => {
    mockedServices.mockResolvedValue(
      createServices({
        userService: {
          setActive: vi.fn().mockRejectedValue(new LastAdministratorError()),
        },
      }),
    );

    const result = (await action({
      context: { get: vi.fn().mockReturnValue(createUser()) },
      params: {},
      request: createPostRequest({
        intent: "set-active",
        isActive: "false",
        userId: "user-1",
      }),
    } as unknown as Parameters<typeof action>[0])) as unknown as {
      data: Record<string, unknown>;
      init?: { status?: number };
    };

    expect(result.init?.status).toBe(409);
    expect(result.data).toMatchObject({ error: "lastAdministrator" });
  });

  it("forbids state changes beyond the actor scope", async () => {
    mockedServices.mockResolvedValue(
      createServices({
        userService: {
          setActive: vi.fn().mockRejectedValue(new UserManagementDeniedError()),
        },
      }),
    );

    const result = (await action({
      context: { get: vi.fn().mockReturnValue(createUser()) },
      params: {},
      request: createPostRequest({
        intent: "set-active",
        isActive: "false",
        userId: "user-2",
      }),
    } as unknown as Parameters<typeof action>[0])) as unknown as {
      data: Record<string, unknown>;
      init?: { status?: number };
    };

    expect(result.init?.status).toBe(403);
    expect(result.data).toMatchObject({ error: "forbidden" });
  });

  it("rethrows unexpected state change failures", async () => {
    mockedServices.mockResolvedValue(
      createServices({
        userService: {
          setActive: vi.fn().mockRejectedValue(new Error("Disk broken")),
        },
      }),
    );

    await expect(
      action({
        context: { get: vi.fn().mockReturnValue(createUser()) },
        params: {},
        request: createPostRequest({
          intent: "set-active",
          isActive: "true",
          userId: "user-2",
        }),
      } as unknown as Parameters<typeof action>[0]),
    ).rejects.toThrow("Disk broken");
  });
});
