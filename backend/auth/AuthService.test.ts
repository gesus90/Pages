import { expect, it, vi } from "vitest";

import { AuthService } from "@/backend/auth/AuthService";
import {
  LoginThrottle,
  TooManyLoginAttemptsError,
} from "@/backend/auth/LoginThrottle";
import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { PermissionService } from "@/backend/auth/PermissionService";
import { SessionService } from "@/backend/auth/SessionService";
import { Database } from "@/backend/database/Database";
import { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { UserService } from "@/backend/service/UserService";
import { ROLE } from "@/definition/Role";

import type { LoginThrottleOptions } from "@/backend/auth/LoginThrottle";
import type { UserCredentials } from "@/backend/database/repositories/UserRepository";
import type { User } from "@/definition/User";

vi.mock("@/backend/database/Database", () => ({
  Database: { connect: async () => ({}) },
}));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

const DECOY_HASH_PATTERN = /^scrypt\$32768\$8\$3\$/u;

const employee: User = {
  id: "user-1",
  username: "ada",
  displayName: "Ada Lovelace",
  role: ROLE.EMPLOYEE,
  isActive: true,
  mustChangePassword: false,
};

interface Harness {
  readonly auth: AuthService;
  readonly hasher: PasswordHasher;
  readonly sessions: SessionService;
  readonly userService: UserService;
}

async function createHarness(
  throttleOptions: LoginThrottleOptions = {},
): Promise<Harness> {
  const database = await Database.connect("postgres://simulated");
  const hasher = new PasswordHasher();
  const userService = new UserService(
    new UserRepository({
      query: vi.fn(),
      execute: vi.fn(),
      transaction: async () => {
        throw new Error("unexpected transaction");
      },
    }),
    new PermissionService(),
  );
  const sessions = new SessionService(
    new SessionRepository(database),
    userService,
  );
  const auth = new AuthService(
    userService,
    sessions,
    hasher,
    new LoginThrottle(throttleOptions),
  );

  return { auth, hasher, sessions, userService };
}

async function storedCredentials(
  hasher: PasswordHasher,
  password: string,
  user: Partial<User> = {},
): Promise<UserCredentials> {
  return {
    user: { ...employee, ...user },
    passwordHash: await hasher.hash(password),
  };
}

it("rejects an unknown user after verifying against a decoy hash of the same cost", async () => {
  const { auth, hasher, userService } = await createHarness();
  vi.spyOn(userService, "findCredentialsByUsername").mockResolvedValue(null);
  const verify = vi.spyOn(hasher, "verify");

  expect(await auth.login("nobody", "guess")).toBeNull();

  expect(verify).toHaveBeenCalledWith(
    expect.stringMatching(DECOY_HASH_PATTERN),
    "guess",
  );
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      level: "warn",
      event: "auth.login.rejected",
    }),
  );
});

it("computes the decoy hash once for repeated unknown logins", async () => {
  const { auth, hasher, userService } = await createHarness();
  vi.spyOn(userService, "findCredentialsByUsername").mockResolvedValue(null);
  const hash = vi.spyOn(hasher, "hash");

  await auth.login("nobody", "guess");
  await auth.login("nobody", "another guess");

  expect(hash).toHaveBeenCalledTimes(1);
});

it("does not look up a username that contains a NUL character", async () => {
  const { auth, userService } = await createHarness();
  const find = vi.spyOn(userService, "findCredentialsByUsername");

  expect(await auth.login("ada\u0000", "guess")).toBeNull();
  expect(find).not.toHaveBeenCalled();
});

it("rejects a wrong password and counts the failure against the username", async () => {
  const { auth, hasher, userService } = await createHarness({
    maxFailuresPerUsername: 1,
  });
  vi.spyOn(userService, "findCredentialsByUsername").mockResolvedValue(
    await storedCredentials(hasher, "correct-password"),
  );

  expect(await auth.login("ada", "wrong-password")).toBeNull();
  await expect(auth.login("ada", "correct-password")).rejects.toBeInstanceOf(
    TooManyLoginAttemptsError,
  );
});

it("rejects an inactive account even with the right password", async () => {
  const { auth, hasher, userService } = await createHarness();
  vi.spyOn(userService, "findCredentialsByUsername").mockResolvedValue(
    await storedCredentials(hasher, "correct-password", { isActive: false }),
  );

  expect(await auth.login("ada", "correct-password")).toBeNull();
});

it("rejects an agent account even with the right password", async () => {
  const { auth, hasher, userService } = await createHarness();
  vi.spyOn(userService, "findCredentialsByUsername").mockResolvedValue(
    await storedCredentials(hasher, "correct-password", { isAgent: true }),
  );

  expect(await auth.login("ada", "correct-password")).toBeNull();
});

it("starts a session for a valid login and clears the earlier failures of the username", async () => {
  const { auth, hasher, sessions, userService } = await createHarness({
    maxFailuresPerUsername: 2,
  });
  vi.spyOn(userService, "findCredentialsByUsername").mockResolvedValue(
    await storedCredentials(hasher, "correct-password"),
  );
  const createSession = vi
    .spyOn(sessions, "createSession")
    .mockResolvedValue("session-token");

  expect(await auth.login("ada", "wrong-password")).toBeNull();
  expect(await auth.login("ada", "correct-password", "Chrome/120")).toEqual({
    user: employee,
    sessionToken: "session-token",
  });
  expect(createSession).toHaveBeenCalledWith("user-1", "Chrome/120");
  expect(await auth.login("ada", "wrong-password")).toBeNull();
  expect(await auth.login("ada", "correct-password")).toEqual({
    user: employee,
    sessionToken: "session-token",
  });
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "auth.login.succeeded",
      metadata: { userId: "user-1" },
    }),
  );
});

it("blocks a login before the account is looked up once the username limit is reached", async () => {
  const { auth, hasher, userService } = await createHarness({
    maxFailuresPerUsername: 1,
  });
  const find = vi
    .spyOn(userService, "findCredentialsByUsername")
    .mockResolvedValue(await storedCredentials(hasher, "correct-password"));

  expect(await auth.login("ada", "wrong-password")).toBeNull();
  await expect(auth.login("ada", "correct-password")).rejects.toBeInstanceOf(
    TooManyLoginAttemptsError,
  );
  expect(find).toHaveBeenCalledTimes(1);
});

it("reports a failure to create the decoy hash and computes it again for the next attempt", async () => {
  const { auth, hasher, userService } = await createHarness();
  vi.spyOn(userService, "findCredentialsByUsername").mockResolvedValue(null);
  const failure = new Error("hashing unavailable");
  const hash = vi.spyOn(hasher, "hash").mockRejectedValueOnce(failure);

  await expect(auth.login("nobody", "guess")).rejects.toBe(failure);
  expect(logCaughtError).toHaveBeenCalledWith("AuthService", failure);

  expect(await auth.login("nobody", "guess")).toBeNull();
  expect(hash).toHaveBeenCalledTimes(2);
});

it("reports an invalid current password for an unknown user without changing anything", async () => {
  const { auth, userService } = await createHarness();
  vi.spyOn(userService, "findCredentialsByUsername").mockResolvedValue(null);
  const update = vi.spyOn(userService, "updatePasswordHash");

  expect(
    await auth.changePassword(
      "nobody",
      "old-password",
      "new-password",
      "token",
    ),
  ).toBe("invalidCurrent");
  expect(update).not.toHaveBeenCalled();
});

it("reports an invalid current password when it does not match", async () => {
  const { auth, hasher, userService } = await createHarness();
  vi.spyOn(userService, "findCredentialsByUsername").mockResolvedValue(
    await storedCredentials(hasher, "old-password"),
  );
  const update = vi.spyOn(userService, "updatePasswordHash");

  expect(
    await auth.changePassword("ada", "wrong-password", "new-password", "token"),
  ).toBe("invalidCurrent");
  expect(update).not.toHaveBeenCalled();
});

it("reports an unchanged password when the new password equals the current one", async () => {
  const { auth, hasher, sessions, userService } = await createHarness();
  vi.spyOn(userService, "findCredentialsByUsername").mockResolvedValue(
    await storedCredentials(hasher, "same-password"),
  );
  const update = vi.spyOn(userService, "updatePasswordHash");
  const revokeOthers = vi.spyOn(sessions, "revokeOtherSessions");

  expect(
    await auth.changePassword("ada", "same-password", "same-password", "token"),
  ).toBe("unchanged");
  expect(update).not.toHaveBeenCalled();
  expect(revokeOthers).not.toHaveBeenCalled();
});

it("stores the new password hash and revokes the other sessions on success", async () => {
  const { auth, hasher, sessions, userService } = await createHarness();
  vi.spyOn(userService, "findCredentialsByUsername").mockResolvedValue(
    await storedCredentials(hasher, "old-password"),
  );
  const update = vi
    .spyOn(userService, "updatePasswordHash")
    .mockResolvedValue(undefined);
  const revokeOthers = vi
    .spyOn(sessions, "revokeOtherSessions")
    .mockResolvedValue(undefined);

  expect(
    await auth.changePassword(
      "ada",
      "old-password",
      "new-password",
      "current-token",
    ),
  ).toBe("success");

  const [userId, newHash] = update.mock.calls[0];
  expect(userId).toBe("user-1");
  expect(await hasher.verify(newHash, "new-password")).toBe(true);
  expect(revokeOthers).toHaveBeenCalledWith("user-1", "current-token");
});

it("ends the session of the token and logs the completion", async () => {
  const { auth, sessions } = await createHarness();
  const revoke = vi.spyOn(sessions, "revoke").mockResolvedValue(undefined);

  await auth.logout("token");

  expect(revoke).toHaveBeenCalledWith("token");
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      level: "info",
      event: "auth.logout.completed",
    }),
  );
});

it("resolves the user behind a session token through the session service", async () => {
  const { auth, sessions } = await createHarness();
  const authenticate = vi
    .spyOn(sessions, "authenticate")
    .mockResolvedValueOnce(employee)
    .mockResolvedValueOnce(null);

  expect(await auth.getAuthenticatedUser("token")).toEqual(employee);
  expect(await auth.getAuthenticatedUser(null)).toBeNull();
  expect(authenticate).toHaveBeenNthCalledWith(1, "token");
  expect(authenticate).toHaveBeenNthCalledWith(2, null);
});
