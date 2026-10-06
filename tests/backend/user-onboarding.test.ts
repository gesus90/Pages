import { describe, expect, it } from "vitest";

import { AuthService } from "@/backend/auth/AuthService";
import { LoginThrottle } from "@/backend/auth/LoginThrottle";
import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { PermissionService } from "@/backend/auth/PermissionService";
import { SessionService } from "@/backend/auth/SessionService";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import { UserService } from "@/backend/service/UserService";
import { ROLE } from "@/definition/Role";
import { createUser } from "../helpers/factories";
import { useMigratedDatabase } from "../helpers/test-database";

describe("account onboarding on DuckDB", () => {
  const getDatabase = useMigratedDatabase();
  const account = {
    id: "new",
    username: "new",
    displayName: "New User",
    role: ROLE.EMPLOYEE,
  };

  function services(): {
    users: UserService;
    repository: UserRepository;
    hasher: PasswordHasher;
    sessions: SessionService;
    auth: AuthService;
  } {
    const repository = new UserRepository(getDatabase());
    const users = new UserService(repository, new PermissionService());
    const hasher = new PasswordHasher();
    const sessions = new SessionService(
      new SessionRepository(getDatabase()),
      users,
    );
    return {
      users,
      repository,
      hasher,
      sessions,
      auth: new AuthService(users, sessions, hasher, new LoginThrottle()),
    };
  }

  it("generates a per-account password and requires its replacement", async () => {
    const { users, repository, hasher, auth, sessions } = services();
    const { temporaryPassword } = await users.createWithTemporaryPassword(
      createUser(),
      account,
      hasher,
    );
    const credentials = await repository.findCredentialsByUsername("new");
    expect(credentials?.user.mustChangePassword).toBe(true);
    expect(credentials?.passwordHash).not.toBe(temporaryPassword);
    const first = await auth.login("new", temporaryPassword);
    const second = await auth.login("new", temporaryPassword);
    expect(first?.user.mustChangePassword).toBe(true);
    expect(
      await auth.changePassword(
        "new",
        "incorrect",
        "chosen-password",
        first?.sessionToken ?? null,
      ),
    ).toBe("invalidCurrent");
    expect(
      await auth.changePassword(
        "new",
        temporaryPassword,
        temporaryPassword,
        first?.sessionToken ?? null,
      ),
    ).toBe("unchanged");
    expect(
      await auth.changePassword(
        "new",
        temporaryPassword,
        "chosen-password",
        first?.sessionToken ?? null,
      ),
    ).toBe("success");
    expect(
      await sessions.authenticate(first?.sessionToken ?? null),
    ).toMatchObject({ mustChangePassword: false });
    expect(
      await sessions.authenticate(second?.sessionToken ?? null),
    ).toBeNull();
    expect(await auth.login("new", temporaryPassword)).toBeNull();
  });

  it("resets the password, forces replacement again and atomically revokes sessions", async () => {
    const { users, hasher, auth, sessions } = services();
    const created = await users.createWithTemporaryPassword(
      createUser(),
      account,
      hasher,
    );
    const login = await auth.login("new", created.temporaryPassword);
    const reset = await users.resetPassword(createUser(), account.id, hasher);
    expect(reset.temporaryPassword).not.toBe(created.temporaryPassword);
    expect(await sessions.authenticate(login?.sessionToken ?? null)).toBeNull();
    expect(await auth.login("new", created.temporaryPassword)).toBeNull();
    expect(await auth.login("new", reset.temporaryPassword)).toMatchObject({
      user: { mustChangePassword: true },
    });
  });

  it("does not create accounts for actors without user-management permission", async () => {
    const { users, repository, hasher } = services();
    await expect(
      users.createWithTemporaryPassword(
        createUser({ role: ROLE.EMPLOYEE }),
        account,
        hasher,
      ),
    ).rejects.toThrow();
    expect(await repository.findById(account.id)).toBeNull();
  });

  it("revokes sessions permanently on deactivation and needs a new login after reactivation", async () => {
    const { users, hasher, auth, sessions } = services();
    const created = await users.createWithTemporaryPassword(
      createUser(),
      account,
      hasher,
    );
    const first = await auth.login("new", created.temporaryPassword);
    const second = await auth.login("new", created.temporaryPassword);
    await users.setActive(createUser(), account.id, false);
    expect(await sessions.authenticate(first?.sessionToken ?? null)).toBeNull();
    expect(await auth.login("new", created.temporaryPassword)).toBeNull();
    expect(await getDatabase().query("SELECT COUNT(*) FROM sessions;")).toEqual(
      [[0]],
    );
    await users.setActive(createUser(), account.id, true);
    expect(await sessions.authenticate(first?.sessionToken ?? null)).toBeNull();
    expect(
      await sessions.authenticate(second?.sessionToken ?? null),
    ).toBeNull();
    expect(await auth.login("new", created.temporaryPassword)).toMatchObject({
      user: { isActive: true },
    });
  });
});
