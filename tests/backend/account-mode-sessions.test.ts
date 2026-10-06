import { describe, expect, it } from "vitest";

import { AuthService } from "@/backend/auth/AuthService";
import { LoginThrottle } from "@/backend/auth/LoginThrottle";
import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { PermissionService } from "@/backend/auth/PermissionService";
import { SessionService } from "@/backend/auth/SessionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import { AdministrationService } from "@/backend/service/AdministrationService";
import { UserService } from "@/backend/service/UserService";
import { PERMISSION } from "@/definition/Role";
import { createRole } from "../helpers/authorization";
import { useMigratedDatabase } from "../helpers/test-database";

describe("account-wide administrator mode through persisted sessions", () => {
  const getDatabase = useMigratedDatabase();
  it("revokes admin power on every device and restores the selected mode on later logins", async () => {
    const database = getDatabase();
    const repository = new AuthorizationRepository(database);
    const hasher = new PasswordHasher();
    const administration = new AdministrationService(
      repository,
      new ServerCache(),
      hasher,
    );
    const permissions = new PermissionService((id) =>
      administration.getContext(id),
    );
    const users = new UserService(repository.users(), permissions);
    const sessions = new SessionService(new SessionRepository(database), users);
    const auth = new AuthService(users, sessions, hasher, new LoginThrottle());
    await repository.users().insert({
      id: "root",
      username: "root",
      displayName: "Root",
      role: "admin",
      passwordHash: "hash",
    });
    await administration.saveRole(
      "root",
      createRole({ id: "reader", permissions: [] }),
    );
    const { temporaryPassword } = await administration.createUser("root", {
      username: "person",
      firstName: "New",
      lastName: "Person",
      email: null,
      roleId: "reader",
      isAdmin: true,
      departments: [],
    });
    const onboarding = await auth.login("person", temporaryPassword);
    if (!onboarding) throw new Error("Missing onboarding login");
    await auth.changePassword(
      "person",
      temporaryPassword,
      "replacement-password",
      onboarding.sessionToken,
    );
    const second = await auth.login("person", "replacement-password");
    if (!second) throw new Error("Missing second device login");
    const staleAdmin = second.user;
    expect(
      await permissions.allows(staleAdmin, PERMISSION.MANAGE_APPLICATION),
    ).toBe(true);
    const before = await administration.version(staleAdmin.id);
    await administration.setMode(staleAdmin.id, "role");
    expect(
      await permissions.allows(staleAdmin, PERMISSION.MANAGE_APPLICATION),
    ).toBe(false);
    expect(await administration.canEnter(staleAdmin.id)).toBe(false);
    expect(await administration.version(staleAdmin.id)).not.toBe(before);
    expect(await sessions.authenticate(onboarding.sessionToken)).toMatchObject({
      role: "employee",
    });
    expect(await sessions.authenticate(second.sessionToken)).toMatchObject({
      role: "employee",
    });
    const third = await auth.login("person", "replacement-password");
    if (!third) throw new Error("Missing resumed login");
    expect((await administration.getContext(third.user.id)).mode).toBe("role");
    await administration.setMode(staleAdmin.id, "admin");
    expect(
      await permissions.allows(third.user, PERMISSION.MANAGE_APPLICATION),
    ).toBe(true);
    await administration.setActive("root", staleAdmin.id, false);
    await administration.setActive("root", staleAdmin.id, true);
    expect(await sessions.authenticate(onboarding.sessionToken)).toBeNull();
    expect(await sessions.authenticate(second.sessionToken)).toBeNull();
    expect(await sessions.authenticate(third.sessionToken)).toBeNull();
  });
});
