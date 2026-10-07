import { describe, expect, it, vi } from "vitest";
import { handleUsersAction } from "@/app/lib/user-actions/user-actions.server";
import { AdministrationError } from "@/backend/error/AdministrationError";
import {
  EmailTakenError,
  LastAdministratorError,
  RoleAssignmentDeniedError,
  UserManagementDeniedError,
  UserNotFoundError,
  UsernameTakenError,
} from "@/backend/error/UserErrors";
import { createUser } from "../helpers/factories";
import type { ApplicationServices } from "@/app/lib/services.server";

const VALID_CREATE = {
  intent: "create-user",
  firstName: "New",
  lastName: "Person",
  username: "new",
  role: "junior",
};
const VALID_UPDATE = {
  intent: "update-user",
  firstName: "New",
  lastName: "Name",
  username: "new",
  userId: "target",
  email: "new@test.invalid",
};

function doubles(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    createUser: vi.fn().mockResolvedValue({ temporaryPassword: "generated" }),
    resetPassword: vi.fn().mockResolvedValue({ temporaryPassword: "reset" }),
    updateProfile: vi.fn(),
    setActive: vi.fn(),
    assignRole: vi.fn(),
    saveRole: vi.fn(),
    deleteRole: vi.fn(),
    saveDepartment: vi.fn(),
    deleteDepartment: vi.fn(),
    setMemberships: vi.fn(),
    setScope: vi.fn(),
    setAdministrator: vi.fn(),
  };
}

const groupService = {
  saveGroup: vi.fn(),
  deleteGroup: vi.fn(),
};

async function run(
  fields: Record<string, string | File | readonly string[] | undefined>,
  administration = doubles(),
): Promise<Awaited<ReturnType<typeof handleUsersAction>>> {
  const formData = new FormData();
  for (const [name, entry] of Object.entries(fields)) {
    if (entry === undefined) continue;
    if (Array.isArray(entry))
      for (const item of entry) formData.append(name, item);
    else formData.append(name, entry as string | File);
  }
  return handleUsersAction(formData.get("intent"), {
    actor: createUser(),
    formData,
    services: {
      administrationService: administration,
      groupAdministrationService: groupService,
    } as unknown as ApplicationServices,
  });
}

describe("directory action validation", () => {
  it.each(["", "unknown", "__proto__", "toString"])(
    "rejects unknown intent %s",
    async (intent) => {
      expect((await run({ intent })).data).toMatchObject({
        ok: false,
        error: "invalidInput",
      });
    },
  );
  it("rejects a missing intent", async () => {
    expect((await run({})).init?.status).toBe(400);
  });

  it.each([
    { firstName: "" },
    { firstName: " " },
    { lastName: "" },
    { username: "" },
    { firstName: "x".repeat(201) },
    { lastName: "x".repeat(201) },
    { username: "x".repeat(201) },
    { email: "bad" },
    { email: `${"e".repeat(320)}@a.co` },
    { firstName: new File([], "name") },
  ])("rejects malformed onboarding %j", async (override) => {
    const services = doubles();
    const result = await run({ ...VALID_CREATE, ...override }, services);
    expect(result.init?.status).toBe(400);
    expect(services.createUser).not.toHaveBeenCalled();
  });

  it("trims names, keeps optional email and delegates role checks without coercion", async () => {
    const services = doubles();
    const result = await run(
      {
        ...VALID_CREATE,
        firstName: " New ",
        email: " a@b.co ",
        department: ["frontend", "backend"],
      },
      services,
    );
    expect(result.data).toEqual({
      intent: "create-user",
      ok: true,
      temporaryPassword: "generated",
    });
    expect(services.createUser).toHaveBeenCalledWith("user-1", {
      firstName: "New",
      lastName: "Person",
      username: "new",
      email: "a@b.co",
      roleId: "junior",
      isAdmin: false,
      departments: ["frontend", "backend"],
    });
    expect(result.init?.headers).toEqual({ "Cache-Control": "no-store" });
    await run({ ...VALID_CREATE, role: "", isAdmin: "true" }, services);
    expect(services.createUser).toHaveBeenLastCalledWith(
      "user-1",
      expect.objectContaining({ roleId: null, isAdmin: true, email: null }),
    );
  });

  it("passes profile fields, not password or personal-admin overrides", async () => {
    const services = doubles();
    expect(
      (
        await run(
          { ...VALID_UPDATE, firstName: " New ", isAdmin: "true" },
          services,
        )
      ).data,
    ).toEqual({ intent: "update-user", ok: true });
    expect(services.updateProfile).toHaveBeenCalledWith("user-1", "target", {
      firstName: "New",
      lastName: "Name",
      username: "new",
      email: "new@test.invalid",
      userId: "target",
    });
  });

  it.each([
    { userId: "" },
    { userId: " " },
    { firstName: "", lastName: "" },
    { username: " " },
    { email: "bad" },
    { firstName: "x".repeat(201) },
  ])("rejects invalid profile fields %j", async (override) => {
    expect((await run({ ...VALID_UPDATE, ...override })).data).toMatchObject({
      ok: false,
      error: "invalidInput",
    });
  });

  it.each([
    { intent: "set-active", isActive: "true" },
    { intent: "set-active", userId: new File([], "id"), isActive: "true" },
    { intent: "set-active", userId: "target", isActive: "unknown" },
    { intent: "set-role", role: "junior" },
    { intent: "set-role", userId: " " },
    { intent: "set-role", userId: "target", role: "" },
    { intent: "reset-password" },
  ])("rejects malformed account operations %j", async (fields) => {
    expect((await run(fields)).init?.status).toBe(400);
  });

  it("delegates activation, role assignment and password reset to the authorized service", async () => {
    const services = doubles();
    await run(
      { intent: "set-active", userId: "target", isActive: "false" },
      services,
    );
    expect(services.setActive).toHaveBeenCalledWith("user-1", "target", false);
    await run(
      { intent: "set-role", userId: "target", role: "custom-role" },
      services,
    );
    expect(services.assignRole).toHaveBeenCalledWith(
      "user-1",
      "target",
      "custom-role",
    );
    const reset = await run(
      { intent: "reset-password", userId: "target" },
      services,
    );
    expect(reset.data).toEqual({
      intent: "reset-password",
      ok: true,
      userId: "target",
      temporaryPassword: "reset",
    });
    expect(reset.init?.headers).toEqual({ "Cache-Control": "no-store" });
  });

  it.each([
    [new UsernameTakenError("x"), 409, "usernameTaken"],
    [new EmailTakenError("x"), 409, "emailTaken"],
    [new UserManagementDeniedError(), 403, "forbidden"],
    [new RoleAssignmentDeniedError(), 403, "forbidden"],
    [new UserNotFoundError(), 404, "userNotFound"],
    [new LastAdministratorError(), 409, "lastAdministrator"],
    [new AdministrationError("forbidden"), 403, "forbidden"],
    [new AdministrationError("notFound"), 404, "userNotFound"],
  ])(
    "translates rejected management operations %s",
    async (error, status, code) => {
      const services = doubles();
      services.createUser.mockRejectedValue(error);
      const result = await run(VALID_CREATE, services);
      expect(result.init?.status).toBe(status);
      expect(result.data).toMatchObject({ ok: false, error: code });
    },
  );

  it.each([
    ["update-user", "updateProfile", VALID_UPDATE],
    [
      "set-active",
      "setActive",
      { intent: "set-active", userId: "target", isActive: "true" },
    ],
    [
      "reset-password",
      "resetPassword",
      { intent: "reset-password", userId: "target" },
    ],
  ] as const)(
    "handles service rejections for %s",
    async (_intent, method, fields) => {
      const services = doubles();
      services[method].mockRejectedValue(new UserNotFoundError());
      expect((await run(fields, services)).data).toMatchObject({
        error: "userNotFound",
      });
    },
  );

  it("preserves the last-admin error distinction and propagates unexpected failures", async () => {
    const services = doubles();
    services.assignRole.mockRejectedValue(new LastAdministratorError());
    expect(
      (await run({ intent: "set-role", role: "r", userId: "target" }, services))
        .data,
    ).toMatchObject({ error: "demoteLastAdministrator" });
    services.createUser.mockRejectedValue(new Error("disk full"));
    await expect(run(VALID_CREATE, services)).rejects.toThrow("disk full");
  });
});

describe("role, department and scope action validation", () => {
  it("passes validated role and department fields", async () => {
    const services = doubles();
    await run(
      {
        intent: "save-role",
        entityId: "",
        name: "Junior",
        rank: "10",
        permission: ["write"],
        departmentBound: "true",
      },
      services,
    );
    expect(services.saveRole).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        id: expect.any(String),
        name: "Junior",
        rank: 10,
        permissions: ["write"],
        departmentBound: true,
      }),
    );
    await run(
      { intent: "save-role", entityId: "role", name: "Reader", rank: "0" },
      services,
    );
    expect(services.saveRole).toHaveBeenLastCalledWith(
      "user-1",
      expect.objectContaining({ id: "role", departmentBound: false }),
    );
    await run(
      { intent: "save-department", entityId: "", name: "HR" },
      services,
    );
    await run(
      { intent: "save-department", entityId: "hr", name: "HR" },
      services,
    );
    expect(services.saveDepartment).toHaveBeenLastCalledWith("user-1", {
      id: "hr",
      name: "HR",
    });
    await run({ intent: "delete-role", entityId: "role" }, services);
    await run({ intent: "delete-department", entityId: "hr" }, services);
    expect(services.deleteRole).toHaveBeenCalledWith("user-1", "role");
    expect(services.deleteDepartment).toHaveBeenCalledWith("user-1", "hr");
  });

  it("saves and deletes groups with their complete member list", async () => {
    await run({
      intent: "save-group",
      entityId: "team",
      name: " Team ",
      member: ["a", "b"],
    });
    expect(groupService.saveGroup).toHaveBeenLastCalledWith("user-1", {
      id: "team",
      memberIds: ["a", "b"],
      name: "Team",
    });
    await run({
      intent: "save-group",
      entityId: "",
      name: "New",
      member: ["a"],
    });
    expect(groupService.saveGroup).toHaveBeenLastCalledWith("user-1", {
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      memberIds: ["a"],
      name: "New",
    });
    await run({ intent: "delete-group", entityId: "team" });
    expect(groupService.deleteGroup).toHaveBeenCalledWith("user-1", "team");
  });

  it("delegates membership changes and explicit personal grants separately", async () => {
    const services = doubles();
    await run(
      { intent: "set-memberships", userId: "target", department: ["hr"] },
      services,
    );
    expect(services.setMemberships).toHaveBeenCalledWith("user-1", "target", [
      "hr",
    ]);
    await run(
      {
        intent: "set-scope",
        userId: "target",
        allDepartments: "true",
        allProjects: "true",
        department: [],
      },
      services,
    );
    expect(services.setScope).toHaveBeenCalledWith("user-1", "target", {
      allDepartments: true,
      allProjects: true,
      managedDepartments: [],
    });
    await run({ intent: "set-scope", userId: "target" }, services);
    await run(
      { intent: "set-admin", userId: "target", isAdmin: "true" },
      services,
    );
    expect(services.setAdministrator).toHaveBeenCalledWith(
      "user-1",
      "target",
      true,
    );
    await run({ intent: "set-admin", userId: "target" }, services);
    expect(services.setAdministrator).toHaveBeenLastCalledWith(
      "user-1",
      "target",
      false,
    );
  });

  it.each([
    { intent: "save-role", entityId: "", name: "R", rank: "" },
    {
      intent: "save-role",
      entityId: "",
      name: "R",
      rank: "1",
      permission: ["unknown"],
    },
    {
      intent: "save-role",
      entityId: "",
      name: "R",
      rank: "1",
      permission: new File([], "permission"),
    },
    { intent: "delete-role" },
  ])("rejects malformed catalog requests %j", async (fields) => {
    expect((await run(fields)).data).toMatchObject({
      ok: false,
      error: "invalidInput",
    });
  });
});
