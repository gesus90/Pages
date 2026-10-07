import { describe, expect, it } from "vitest";
import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { AdministrationService } from "@/backend/service/AdministrationService";
import { CAPABILITY } from "@/definition/Authorization";
import { createAccess, createRole } from "../helpers/authorization";
import { useMigratedDatabase } from "../helpers/test-database";

import type { AccountCreateInput, UserRole } from "@/definition/Authorization";

describe("AdministrationService on DuckDB", () => {
  const getDatabase = useMigratedDatabase();
  const profile: AccountCreateInput = {
    username: "created",
    firstName: "New",
    lastName: "Person",
    email: null,
    roleId: "junior",
    isAdmin: false,
    departments: [],
  };

  async function setup(): Promise<{
    service: AdministrationService;
    repository: AuthorizationRepository;
    cache: ServerCache;
  }> {
    const repository = new AuthorizationRepository(getDatabase());
    const cache = new ServerCache();
    const service = new AdministrationService(
      repository,
      cache,
      new PasswordHasher(),
    );
    await repository.transaction(async (scope) => {
      await scope.saveRole(createRole());
      await scope.saveRole(
        createRole({
          id: "junior",
          rank: 10,
          name: "Junior",
          permissions: [CAPABILITY.WRITE],
        }),
      );
      for (const id of ["frontend", "backend", "hr"]) {
        await scope.saveDepartment({ id, name: id });
      }
      await scope.users().insert({
        id: "admin",
        username: "admin",
        displayName: "Admin",
        role: "admin",
        passwordHash: "hash",
      });
      for (const id of ["manager", "target", "outside"]) {
        const roleId = id === "manager" ? "role" : "junior";
        await scope.users().insert({
          id,
          username: id,
          displayName: id,
          role: "employee",
          passwordHash: "hash",
          email: `${id}@test.invalid`,
          authorization: {
            roleId,
            isAdmin: false,
            mode: "role",
            firstName: id,
            lastName: "",
          },
        });
        await scope.saveAccount(
          createAccess({
            userId: id,
            role: createRole({ id: roleId }),
            departments: [id === "outside" ? "hr" : "frontend"],
            managedDepartments: id === "manager" ? ["frontend", "backend"] : [],
          }),
        );
      }
    });
    return { service, repository, cache };
  }

  it("filters directory identities, addresses, roles and departments consistently", async () => {
    const { service } = await setup();
    expect(await service.canEnter("admin")).toBe(true);
    expect(await service.canEnter("target")).toBe(false);
    const snapshot = await service.directory("manager");
    expect(snapshot.accounts.map((account) => account.userId)).not.toContain(
      "outside",
    );
    expect(
      snapshot.departments.map((department) => department.id),
    ).not.toContain("hr");
    expect(
      (await service.listUsers("manager")).map((user) => user.email),
    ).not.toContain("outside@test.invalid");
    expect(await service.listUsers("admin")).toHaveLength(4);
    expect((await service.directory("admin")).departments).toHaveLength(3);
    await expect(service.directory("target")).rejects.toThrow("forbidden");
    await expect(service.listUsers("target")).rejects.toThrow("forbidden");
    await expect(service.getContext("missing")).rejects.toThrow("notFound");
    await service.setActive("admin", "target", false);
    await expect(service.getContext("target")).rejects.toThrow("forbidden");
  });

  it("keeps a shared role outside scope unchanged, including its remote holders", async () => {
    const { service, repository } = await setup();
    const next = createRole({ id: "junior", name: "Changed", rank: 10 });
    await expect(service.saveRole("manager", next)).rejects.toThrow(
      "forbidden",
    );
    expect(
      (await repository.snapshot()).roles.find((role) => role.id === "junior")
        ?.name,
    ).toBe("Junior");
    await service.saveRole("admin", next);
    expect((await service.getContext("outside")).role?.name).toBe("Changed");
    const temporary = createRole({
      id: "unused",
      name: "Unused",
      rank: 10,
      permissions: [CAPABILITY.WRITE],
    });
    await service.saveRole("manager", temporary);
    await service.deleteRole("manager", "unused");
    await expect(service.deleteRole("admin", "missing")).rejects.toThrow(
      "notFound",
    );
    await expect(service.deleteRole("admin", "junior")).rejects.toThrow(
      "inUse",
    );
    await expect(service.deleteRole("manager", "role")).rejects.toThrow(
      "forbidden",
    );
  });

  it.each([
    { name: " " },
    { name: "x".repeat(201) },
    { rank: -1 },
    { rank: 1.5 },
    { permissions: ["unknown"] },
  ])("rejects invalid role input %j", async (overrides) => {
    const { service } = await setup();
    await expect(
      service.saveRole("admin", { ...createRole(), ...overrides } as UserRole),
    ).rejects.toThrow("invalidInput");
  });

  it("creates departments in the manager scope and enforces the final membership exception", async () => {
    const { service, cache } = await setup();
    await service.saveDepartment("manager", { id: "new", name: "New" });
    expect((await service.getContext("manager")).managedDepartments).toContain(
      "new",
    );
    await service.saveDepartment("manager", { id: "new", name: "Renamed" });
    await expect(
      service.saveDepartment("manager", { id: "hr", name: "No" }),
    ).rejects.toThrow("forbidden");
    await expect(service.setMemberships("admin", "target", [])).rejects.toThrow(
      "forbidden",
    );
    await expect(
      service.setMemberships("admin", "target", ["missing"]),
    ).rejects.toThrow("invalidInput");
    await service.setMemberships("manager", "target", ["frontend", "backend"]);
    for (const key of [
      "workitems:q:scope",
      "labels:usage:scope",
      "github:prs:scope",
    ]) {
      cache.set(key, ["department-restricted data"], 60_000);
    }
    await service.deleteDepartment("manager", "frontend");
    expect(cache.get("workitems:q:scope")).toBeUndefined();
    expect(cache.get("labels:usage:scope")).toBeUndefined();
    expect(cache.get("github:prs:scope")).toBeUndefined();
    await service.deleteDepartment("manager", "backend");
    expect(await service.getContext("target")).toMatchObject({
      departments: [],
      hasHadDepartment: true,
    });
    await service.setMemberships("manager", "target", ["new"]);
    await expect(service.setMemberships("admin", "target", [])).rejects.toThrow(
      "forbidden",
    );
  });

  it("persists mode on the account, updates legacy project access and invalidates cached lists", async () => {
    const { service, repository, cache } = await setup();
    await expect(service.setMode("admin", "role")).rejects.toThrow("forbidden");
    await expect(service.setMode("manager", "admin")).rejects.toThrow(
      "forbidden",
    );
    await service.assignRole("admin", "admin", "junior");
    cache.set("projects:list:u:admin", ["private"], 60_000);
    await service.setMode("admin", "role");
    expect((await repository.users().findById("admin"))?.role).toBe("employee");
    expect(cache.get("projects:list:u:admin")).toBeUndefined();
    expect(await service.getContext("admin")).toMatchObject({
      mode: "role",
      isAdmin: true,
    });
    await service.setMode("admin", "admin");
    expect((await repository.users().findById("admin"))?.role).toBe("admin");
    await service.saveRole(
      "admin",
      createRole({
        id: "junior",
        name: "Junior",
        rank: 10,
        permissions: [CAPABILITY.MANAGE_PROJECTS],
      }),
    );
    expect((await repository.users().findById("target"))?.role).toBe("manager");
    await expect(
      service.assignRole("admin", "target", "missing"),
    ).rejects.toThrow("notFound");
    await expect(
      service.assignRole("target", "manager", "junior"),
    ).rejects.toThrow("forbidden");
  });

  it("protects the final active admin and requires a normal role before revocation", async () => {
    const { service, repository } = await setup();
    await expect(
      service.setAdministrator("admin", "admin", false),
    ).rejects.toThrow("lastAdministrator");
    await expect(service.setActive("admin", "admin", false)).rejects.toThrow(
      "lastAdministrator",
    );
    await expect(
      service.setAdministrator("manager", "target", true),
    ).rejects.toThrow("forbidden");
    await service.setAdministrator("admin", "target", true);
    expect(await service.getContext("target")).toMatchObject({
      isAdmin: true,
      mode: "role",
    });
    await expect(
      service.setAdministrator("admin", "admin", false),
    ).rejects.toThrow("invalidInput");
    await service.setAdministrator("admin", "target", false);
    await service.setActive("manager", "target", false);
    expect((await repository.users().findById("target"))?.isActive).toBe(false);
    await service.setActive("manager", "target", true);
    await expect(
      service.setActive("manager", "outside", false),
    ).rejects.toThrow("forbidden");
  });

  it("lets only admin mode grant personal scopes and validates references", async () => {
    const { service } = await setup();
    const scope = {
      managedDepartments: ["hr"],
      allDepartments: true,
      allProjects: true,
    };
    await expect(service.setScope("manager", "target", scope)).rejects.toThrow(
      "forbidden",
    );
    await expect(
      service.setScope("admin", "target", {
        ...scope,
        managedDepartments: ["missing"],
      }),
    ).rejects.toThrow("invalidInput");
    await service.setScope("admin", "manager", scope);
    expect(
      (await service.directory("manager")).accounts.map(
        (account) => account.userId,
      ),
    ).toContain("outside");
  });

  it("creates accounts with one-time credentials and allows only authorized profile edits and resets", async () => {
    const { service, repository } = await setup();
    const created = await service.createUser("admin", {
      ...profile,
      departments: ["frontend"],
    });
    const credentials = await repository
      .users()
      .findCredentialsByUsername("created");
    expect(credentials?.user.mustChangePassword).toBe(true);
    if (!credentials) throw new Error("Missing created account");
    await service.updateProfile("manager", credentials.user.id, {
      ...profile,
      username: "renamed",
      email: "new@test.invalid",
    });
    const reset = await service.resetPassword("manager", credentials.user.id);
    expect(reset.temporaryPassword).not.toBe(created.temporaryPassword);
    await expect(service.resetPassword("manager", "outside")).rejects.toThrow(
      "forbidden",
    );
    await service.createUser("admin", {
      ...profile,
      username: "other-admin",
      isAdmin: true,
      roleId: null,
    });
    const other = await repository
      .users()
      .findCredentialsByUsername("other-admin");
    expect(
      (await repository.snapshot()).accounts.find(
        (account) => account.userId === other?.user.id,
      ),
    ).toMatchObject({ isAdmin: true, mode: "admin", role: null });
    await expect(
      service.createUser("manager", { ...profile, isAdmin: true }),
    ).rejects.toThrow("forbidden");
    await expect(
      service.createUser("admin", { ...profile, roleId: null }),
    ).rejects.toThrow("invalidInput");
    await expect(
      service.createUser("admin", { ...profile, roleId: "missing" }),
    ).rejects.toThrow("invalidInput");
    await expect(
      service.createUser("admin", { ...profile, departments: ["missing"] }),
    ).rejects.toThrow("invalidInput");
  });

  it.each([
    { firstName: "" },
    { lastName: "" },
    { email: "bad" },
    { email: "x".repeat(321) },
  ])("validates new account fields %j", async (override) => {
    const { service } = await setup();
    await expect(
      service.createUser("admin", { ...profile, ...override }),
    ).rejects.toThrow("invalidInput");
  });
  it("keeps account fingerprints and navigation on current facts and validates catalog conflicts", async () => {
    const { service } = await setup();
    const version = await service.version("admin");
    expect((await service.navigation("admin")).version).toBe(version);
    expect((await service.navigation("target")).canViewUsers).toBe(false);
    await service.updateOwnDisplayProfile("admin", {
      displayName: "Updated Admin",
      username: "renamed-admin",
      email: null,
    });
    expect(await service.getContext("admin")).toMatchObject({
      firstName: "Updated Admin",
      lastName: "",
    });
    expect(await service.version("admin")).not.toBe(version);
    await expect(
      service.updateOwnDisplayProfile("manager", {
        displayName: "No",
        username: "manager",
        email: null,
      }),
    ).rejects.toThrow("forbidden");
    await expect(
      service.saveRole(
        "admin",
        createRole({ id: "duplicate", name: "JUNIOR" }),
      ),
    ).rejects.toThrow("invalidInput");
    await expect(
      service.saveDepartment("admin", { id: "duplicate", name: "FRONTEND" }),
    ).rejects.toThrow("invalidInput");
    await expect(
      service.createUser("admin", { ...profile, email: "target@test.invalid" }),
    ).rejects.toThrow("already");
    await service.createUser("admin", {
      ...profile,
      firstName: "N".repeat(150),
      lastName: "S".repeat(150),
    });
  });

  it("uses the union of every management-right combination for identities, addresses and action hints", async () => {
    const { service, repository } = await setup();
    await repository.users().insert({
      id: "backend-target",
      username: "backend-target",
      displayName: "Backend Target",
      email: "backend@test.invalid",
      role: "employee",
      passwordHash: "hash",
      authorization: {
        roleId: "junior",
        isAdmin: false,
        mode: "role",
        firstName: "Backend",
        lastName: "Target",
      },
    });
    await service.setMemberships("admin", "backend-target", ["backend"]);
    await service.setScope("admin", "manager", {
      managedDepartments: ["backend"],
      allDepartments: false,
      allProjects: false,
    });
    const rights = [
      CAPABILITY.MANAGE_USERS,
      CAPABILITY.MANAGE_ROLES,
      CAPABILITY.MANAGE_DEPARTMENTS,
    ];
    for (let mask = 1; mask < 8; mask++) {
      const permissions = rights.filter((_right, index) =>
        Boolean(mask & (1 << index)),
      );
      await service.saveRole("admin", createRole({ permissions }));
      const expected = ["admin"];
      if (mask & 3) expected.push("manager", "target");
      if (mask & 4) expected.push("backend-target");
      const view = await service.pageData("manager");
      expect(view.users.map((user) => user.id).sort()).toEqual(expected.sort());
      expect(view.users.map((user) => user.email)).not.toContain(
        "outside@test.invalid",
      );
      expect(
        (await service.directory("manager")).accounts
          .map((account) => account.userId)
          .sort(),
      ).toEqual(expected.sort());
      expect(view.canManageRoles).toBe(Boolean(mask & 2));
      expect(view.canManageDepartments).toBe(Boolean(mask & 4));
      expect(view.adoptableDepartmentIds).toEqual(
        mask & 4 ? ["backend"] : ["frontend"],
      );
      await expect(service.resetPassword("manager", "outside")).rejects.toThrow(
        "forbidden",
      );
    }
    await service.setScope("admin", "manager", {
      managedDepartments: [],
      allDepartments: true,
      allProjects: false,
    });
    expect((await service.pageData("manager")).users).toHaveLength(5);
    expect((await service.pageData("admin")).editableRoleIds).toHaveLength(2);
    await service.saveRole("admin", createRole({ permissions: [] }));
    await expect(service.pageData("manager")).rejects.toThrow("forbidden");
  });
});
