import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthService } from "@/backend/auth/AuthService";

import type { PasswordHasher } from "@/backend/auth/PasswordHasher";
import type { SessionService } from "@/backend/auth/SessionService";
import type { UserService } from "@/backend/service/UserService";
import type { User } from "@/definition/User";

interface AuthDoubles {
  hasher: PasswordHasher & {
    hash: ReturnType<typeof vi.fn>;
    verify: ReturnType<typeof vi.fn>;
  };
  session: SessionService & {
    authenticate: ReturnType<typeof vi.fn>;
    createSession: ReturnType<typeof vi.fn>;
    revoke: ReturnType<typeof vi.fn>;
  };
  users: UserService & {
    findCredentialsByUsername: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
  };
}

function createDoubles(): AuthDoubles {
  return {
    hasher: {
      hash: vi.fn(),
      verify: vi.fn(),
    } as unknown as AuthDoubles["hasher"],
    session: {
      authenticate: vi.fn(),
      createSession: vi.fn(),
      removeExpiredSessions: vi.fn(),
      revoke: vi.fn(),
    } as unknown as AuthDoubles["session"],
    users: {
      createUser: vi.fn(),
      findCredentialsByUsername: vi.fn(),
      getById: vi.fn(),
    } as unknown as AuthDoubles["users"],
  };
}

function createUser(): User {
  return { displayName: "Admin", id: "user-1", username: "admin" };
}

describe("AuthService", () => {
  let doubles: AuthDoubles;
  let service: AuthService;

  beforeEach(() => {
    doubles = createDoubles();
    service = new AuthService(doubles.users, doubles.session, doubles.hasher);
  });

  it("returns the user and a session token for valid credentials", async () => {
    const user = createUser();
    doubles.users.findCredentialsByUsername.mockResolvedValue({
      passwordHash: "stored-hash",
      user,
    });
    doubles.hasher.verify.mockResolvedValue(true);
    doubles.session.createSession.mockResolvedValue("session-token");

    const result = await service.login("admin", "correct-password");

    expect(result).toEqual({ sessionToken: "session-token", user });
    expect(doubles.users.findCredentialsByUsername).toHaveBeenCalledWith(
      "admin",
    );
    expect(doubles.hasher.verify).toHaveBeenCalledWith(
      "stored-hash",
      "correct-password",
    );
    expect(doubles.session.createSession).toHaveBeenCalledWith("user-1");
  });

  it("returns null for unknown usernames without verifying a password", async () => {
    doubles.users.findCredentialsByUsername.mockResolvedValue(null);

    await expect(service.login("ghost", "password")).resolves.toBeNull();

    expect(doubles.hasher.verify).not.toHaveBeenCalled();
    expect(doubles.session.createSession).not.toHaveBeenCalled();
  });

  it("returns null for wrong passwords without creating a session", async () => {
    doubles.users.findCredentialsByUsername.mockResolvedValue({
      passwordHash: "stored-hash",
      user: createUser(),
    });
    doubles.hasher.verify.mockResolvedValue(false);

    await expect(service.login("admin", "wrong-password")).resolves.toBeNull();

    expect(doubles.session.createSession).not.toHaveBeenCalled();
  });

  it("propagates lookup failures", async () => {
    doubles.users.findCredentialsByUsername.mockRejectedValue(
      new Error("Database unavailable"),
    );

    await expect(service.login("admin", "password")).rejects.toThrow(
      "Database unavailable",
    );
  });

  it("propagates verification failures", async () => {
    doubles.users.findCredentialsByUsername.mockResolvedValue({
      passwordHash: "stored-hash",
      user: createUser(),
    });
    doubles.hasher.verify.mockRejectedValue(new Error("Hasher broken"));

    await expect(service.login("admin", "password")).rejects.toThrow(
      "Hasher broken",
    );
  });

  it("propagates session creation failures", async () => {
    doubles.users.findCredentialsByUsername.mockResolvedValue({
      passwordHash: "stored-hash",
      user: createUser(),
    });
    doubles.hasher.verify.mockResolvedValue(true);
    doubles.session.createSession.mockRejectedValue(
      new Error("Session store broken"),
    );

    await expect(service.login("admin", "password")).rejects.toThrow(
      "Session store broken",
    );
  });

  it("revokes the session token on logout", async () => {
    doubles.session.revoke.mockResolvedValue(undefined);

    await service.logout("session-token");

    expect(doubles.session.revoke).toHaveBeenCalledTimes(1);
    expect(doubles.session.revoke).toHaveBeenCalledWith("session-token");
  });

  it("forwards missing tokens to session revocation", async () => {
    doubles.session.revoke.mockResolvedValue(undefined);

    await service.logout(null);

    expect(doubles.session.revoke).toHaveBeenCalledWith(null);
  });

  it("resolves the authenticated user from a token", async () => {
    const user = createUser();
    doubles.session.authenticate.mockResolvedValue(user);

    await expect(service.getAuthenticatedUser("token")).resolves.toBe(user);
    expect(doubles.session.authenticate).toHaveBeenCalledWith("token");
  });

  it("returns null for missing tokens", async () => {
    doubles.session.authenticate.mockResolvedValue(null);

    await expect(service.getAuthenticatedUser(null)).resolves.toBeNull();
  });
});
