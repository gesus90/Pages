import { describe, expect, it, vi } from "vitest";

import { handleUsersAction } from "@/app/lib/user-actions/user-actions.server";
import { ROLE } from "@/definition/Role";

import { createUser } from "../helpers/factories";
import {
  EmailTakenError,
  LastAdministratorError,
  RoleAssignmentDeniedError,
  UserManagementDeniedError,
  UserNotFoundError,
  UsernameTakenError,
} from "@/backend/error/UserErrors";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { Role } from "@/definition/Role";

interface Outcome {
  readonly data: Record<string, unknown>;
  readonly status: number | undefined;
}

function createFormData(fields: Record<string, string | File>): FormData {
  const formData = new FormData();

  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }

  return formData;
}

function createServices(
  userService: Record<string, unknown> = {},
): ApplicationServices {
  return {
    passwordHasher: { hash: vi.fn().mockResolvedValue("encoded-hash") },
    sessionService: { revokeAllSessions: vi.fn() },
    userService: {
      createUser: vi.fn().mockResolvedValue(undefined),
      setActive: vi.fn().mockResolvedValue(undefined),
      setRole: vi.fn().mockResolvedValue(undefined),
      updateUser: vi.fn().mockResolvedValue(undefined),
      ...userService,
    },
  } as unknown as ApplicationServices;
}

async function run(
  fields: Record<string, string | File>,
  services: ApplicationServices = createServices(),
  actorRole: Role = ROLE.ADMIN,
): Promise<Outcome> {
  const result = (await handleUsersAction(fields.intent ?? null, {
    actor: createUser({ role: actorRole }),
    formData: createFormData(fields),
    services,
  })) as unknown as {
    data: Record<string, unknown>;
    init?: { status?: number };
  };

  return { data: result.data, status: result.init?.status };
}

const VALID_CREATE = {
  displayName: "Newcomer",
  intent: "create-user",
  password: "long-enough-secret",
  username: "newcomer",
};

const VALID_UPDATE = {
  displayName: "New Name",
  email: "new@example.com",
  intent: "update-user",
  userId: "user-2",
  username: "newname",
};

describe("handleUsersAction", () => {
  it.each([null, "rename-user", "toString", "__proto__", ""])(
    "answers the intent %j like an invalid create form",
    async (intent) => {
      const result = await handleUsersAction(intent, {
        actor: createUser(),
        formData: new FormData(),
        services: createServices(),
      });

      expect(result).toMatchObject({
        data: { error: "invalidInput", intent: "create-user", ok: false },
        init: { status: 400 },
      });
    },
  );
});

describe("create-user", () => {
  it.each([
    ["without a name", { displayName: "" }],
    ["with a blank name", { displayName: "   " }],
    ["without a username", { username: "" }],
    ["with a short password", { password: "1234567" }],
    ["with a long password", { password: "p".repeat(1001) }],
    ["with a long name", { displayName: "n".repeat(201) }],
    ["with a long username", { username: "u".repeat(201) }],
    ["with a malformed email", { email: "nobody" }],
    ["with a long email", { email: `${"e".repeat(320)}@example.com` }],
  ])("rejects a form %s", async (_label, override) => {
    const services = createServices();
    const result = await run({ ...VALID_CREATE, ...override }, services);

    expect(result.status).toBe(400);
    expect(result.data).toEqual({
      error: "invalidInput",
      intent: "create-user",
      ok: false,
    });
    expect(services.userService.createUser).not.toHaveBeenCalled();
  });

  it("rejects fields that are no text", async () => {
    const result = await run({
      ...VALID_CREATE,
      password: new File(["secret"], "secret.txt"),
    });

    expect(result.status).toBe(400);
  });

  it("trims names and keeps a valid email", async () => {
    const services = createServices();
    const result = await run(
      { ...VALID_CREATE, displayName: "  Newcomer ", email: " a@b.co " },
      services,
    );

    expect(result.data).toEqual({ intent: "create-user", ok: true });
    expect(services.userService.createUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        displayName: "Newcomer",
        email: "a@b.co",
        passwordHash: "encoded-hash",
      }),
    );
  });

  it.each([
    ["administrators choose a valid role", ROLE.ADMIN, "manager", "manager"],
    ["administrators fall back without a role", ROLE.ADMIN, "", "employee"],
    ["administrators ignore an unknown role", ROLE.ADMIN, "root", "employee"],
    ["managers always create employees", ROLE.MANAGER, "admin", "employee"],
  ])("%s", async (_label, actorRole, requested, expected) => {
    const services = createServices();

    await run({ ...VALID_CREATE, role: requested }, services, actorRole);

    expect(services.userService.createUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: null, role: expected }),
    );
  });

  it.each([
    [new UsernameTakenError("x"), 409, "usernameTaken"],
    [new EmailTakenError("x"), 409, "emailTaken"],
    [new UserManagementDeniedError(), 403, "forbidden"],
    [new RoleAssignmentDeniedError(), 403, "forbidden"],
    [new UserNotFoundError(), 404, "userNotFound"],
    [new LastAdministratorError(), 409, "lastAdministrator"],
  ])("maps %s to a response", async (failure, status, code) => {
    const result = await run(
      VALID_CREATE,
      createServices({ createUser: vi.fn().mockRejectedValue(failure) }),
    );

    expect(result.status).toBe(status);
    expect(result.data).toEqual({
      error: code,
      intent: "create-user",
      ok: false,
    });
  });

  it("rethrows unexpected failures", async () => {
    const failure = new Error("disk full");

    await expect(
      run(
        VALID_CREATE,
        createServices({ createUser: vi.fn().mockRejectedValue(failure) }),
      ),
    ).rejects.toBe(failure);
  });
});

describe("update-user", () => {
  it("saves trimmed values", async () => {
    const services = createServices();
    const result = await run(
      {
        ...VALID_UPDATE,
        displayName: " New Name ",
        email: " new@example.com ",
        username: " newname ",
      },
      services,
    );

    expect(result.data).toEqual({ intent: "update-user", ok: true });
    expect(services.userService.updateUser).toHaveBeenCalledWith(
      expect.anything(),
      "user-2",
      {
        displayName: "New Name",
        email: "new@example.com",
        username: "newname",
      },
    );
  });

  it("clears the email address when the field is empty", async () => {
    const services = createServices();

    await run({ ...VALID_UPDATE, email: "" }, services);

    expect(services.userService.updateUser).toHaveBeenCalledWith(
      expect.anything(),
      "user-2",
      expect.objectContaining({ email: null }),
    );
  });

  it.each([
    ["without a user", { userId: "" }],
    ["with a blank user", { userId: "  " }],
    ["without a name", { displayName: "" }],
    ["without a username", { username: " " }],
    ["with a long name", { displayName: "n".repeat(201) }],
    ["with a long username", { username: "u".repeat(201) }],
    ["with a malformed email", { email: "nobody@" }],
  ])("rejects a form %s", async (_label, override) => {
    const services = createServices();
    const result = await run({ ...VALID_UPDATE, ...override }, services);

    expect(result.status).toBe(400);
    expect(result.data).toEqual({
      error: "invalidInput",
      intent: "update-user",
      ok: false,
    });
    expect(services.userService.updateUser).not.toHaveBeenCalled();
  });

  it.each([
    [new UsernameTakenError("x"), 409, "usernameTaken"],
    [new EmailTakenError("x"), 409, "emailTaken"],
    [new UserNotFoundError(), 404, "userNotFound"],
  ])("maps %s to a response", async (failure, status, code) => {
    const result = await run(
      VALID_UPDATE,
      createServices({ updateUser: vi.fn().mockRejectedValue(failure) }),
    );

    expect(result.status).toBe(status);
    expect(result.data).toMatchObject({ error: code, intent: "update-user" });
  });
});

describe("set-role", () => {
  it("assigns the requested role", async () => {
    const services = createServices();
    const result = await run(
      { intent: "set-role", role: "manager", userId: "user-2" },
      services,
    );

    expect(result.data).toEqual({ intent: "set-role", ok: true });
    expect(services.userService.setRole).toHaveBeenCalledWith(
      expect.anything(),
      "user-2",
      "manager",
    );
  });

  it.each([
    ["without a user", { role: "manager" }],
    ["with a blank user", { role: "manager", userId: "  " }],
    ["without a role", { userId: "user-2" }],
    ["with an unknown role", { role: "root", userId: "user-2" }],
  ])("rejects a form %s", async (_label, fields) => {
    const result = await run({ intent: "set-role", ...fields });

    expect(result.status).toBe(400);
    expect(result.data).toEqual({
      error: "invalidInput",
      intent: "set-role",
      ok: false,
    });
  });

  it("explains that the last administrator keeps the role", async () => {
    const result = await run(
      { intent: "set-role", role: "employee", userId: "user-1" },
      createServices({
        setRole: vi.fn().mockRejectedValue(new LastAdministratorError()),
      }),
    );

    expect(result.status).toBe(409);
    expect(result.data).toMatchObject({ error: "demoteLastAdministrator" });
  });

  it("forbids roles beyond the actor scope", async () => {
    const result = await run(
      { intent: "set-role", role: "admin", userId: "user-2" },
      createServices({
        setRole: vi.fn().mockRejectedValue(new RoleAssignmentDeniedError()),
      }),
    );

    expect(result.status).toBe(403);
    expect(result.data).toMatchObject({ error: "forbidden" });
  });
});

describe("set-active", () => {
  it.each([
    ["without a user", { isActive: "true" }],
    [
      "with a user that is no text",
      { isActive: "true", userId: new File([], "x") },
    ],
    ["without a state", { userId: "user-2" }],
    ["with an unknown state", { isActive: "maybe", userId: "user-2" }],
  ])("rejects a form %s", async (_label, fields) => {
    const result = await run({ intent: "set-active", ...fields });

    expect(result.status).toBe(400);
    expect(result.data).toMatchObject({
      error: "invalidInput",
      intent: "set-active",
    });
  });
});
