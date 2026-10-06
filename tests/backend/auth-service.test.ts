import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthService } from "@/backend/auth/AuthService";
import {
  LoginThrottle,
  TooManyLoginAttemptsError,
} from "@/backend/auth/LoginThrottle";

import { createUser } from "../helpers/factories";

import type { PasswordHasher } from "@/backend/auth/PasswordHasher";
import type { SessionService } from "@/backend/auth/SessionService";
import type { UserService } from "@/backend/service/UserService";

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

describe("AuthService", () => {
  let doubles: AuthDoubles;
  let service: AuthService;

  beforeEach(() => {
    doubles = createDoubles();
    service = new AuthService(
      doubles.users,
      doubles.session,
      doubles.hasher,
      new LoginThrottle({ maxFailuresPerUsername: 3 }),
    );
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
    expect(doubles.session.createSession).toHaveBeenCalledWith(
      "user-1",
      undefined,
    );
  });

  it("forwards the browser user agent to the new session", async () => {
    doubles.users.findCredentialsByUsername.mockResolvedValue({
      passwordHash: "stored-hash",
      user: createUser(),
    });
    doubles.hasher.verify.mockResolvedValue(true);
    doubles.session.createSession.mockResolvedValue("session-token");

    await service.login("admin", "correct-password", "Mozilla/5.0 Firefox/130");

    expect(doubles.session.createSession).toHaveBeenCalledWith(
      "user-1",
      "Mozilla/5.0 Firefox/130",
    );
  });

  it("returns null for unknown usernames without creating a session", async () => {
    doubles.users.findCredentialsByUsername.mockResolvedValue(null);
    doubles.hasher.hash.mockResolvedValue("decoy-hash");
    doubles.hasher.verify.mockResolvedValue(false);

    await expect(service.login("ghost", "password")).resolves.toBeNull();

    expect(doubles.session.createSession).not.toHaveBeenCalled();
  });

  it("rejects a deactivated account even with its correct password", async () => {
    doubles.users.findCredentialsByUsername.mockResolvedValue({
      passwordHash: "stored-hash",
      user: createUser({ isActive: false }),
    });
    doubles.hasher.verify.mockResolvedValue(true);
    expect(await service.login("admin", "correct-password")).toBeNull();
    expect(doubles.hasher.verify).toHaveBeenCalledWith(
      "stored-hash",
      "correct-password",
    );
    expect(doubles.session.createSession).not.toHaveBeenCalled();
  });

  it("verifies unknown usernames against a decoy hash so timing does not reveal them", async () => {
    doubles.users.findCredentialsByUsername.mockResolvedValue(null);
    doubles.hasher.hash.mockResolvedValue("decoy-hash");
    doubles.hasher.verify.mockResolvedValue(false);

    await service.login("ghost", "password");
    await service.login("ghost", "other-password");

    expect(doubles.hasher.verify).toHaveBeenNthCalledWith(
      1,
      "decoy-hash",
      "password",
    );
    expect(doubles.hasher.verify).toHaveBeenNthCalledWith(
      2,
      "decoy-hash",
      "other-password",
    );
    expect(doubles.hasher.hash).toHaveBeenCalledTimes(1);
  });

  it("retries creating the decoy hash after a failure", async () => {
    doubles.users.findCredentialsByUsername.mockResolvedValue(null);
    doubles.hasher.hash
      .mockRejectedValueOnce(new Error("Hasher broken"))
      .mockResolvedValueOnce("decoy-hash");
    doubles.hasher.verify.mockResolvedValue(false);

    await expect(service.login("ghost", "password")).rejects.toThrow(
      "Hasher broken",
    );
    await expect(service.login("ghost", "password")).resolves.toBeNull();
    expect(doubles.hasher.hash).toHaveBeenCalledTimes(2);
  });

  it("rejects further attempts after too many failures for a username", async () => {
    doubles.users.findCredentialsByUsername.mockResolvedValue({
      passwordHash: "stored-hash",
      user: createUser(),
    });
    doubles.hasher.verify.mockResolvedValue(false);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(service.login("admin", "wrong")).resolves.toBeNull();
    }

    await expect(service.login("admin", "correct")).rejects.toBeInstanceOf(
      TooManyLoginAttemptsError,
    );
    expect(doubles.hasher.verify).toHaveBeenCalledTimes(3);
    expect(doubles.session.createSession).not.toHaveBeenCalled();
  });

  it("counts failures of unknown and known usernames the same way", async () => {
    doubles.users.findCredentialsByUsername.mockResolvedValue(null);
    doubles.hasher.hash.mockResolvedValue("decoy-hash");
    doubles.hasher.verify.mockResolvedValue(false);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await service.login("ghost", "wrong");
    }

    await expect(service.login("ghost", "wrong")).rejects.toBeInstanceOf(
      TooManyLoginAttemptsError,
    );
  });

  it("forgets earlier failures after a successful login", async () => {
    doubles.users.findCredentialsByUsername.mockResolvedValue({
      passwordHash: "stored-hash",
      user: createUser(),
    });
    doubles.session.createSession.mockResolvedValue("session-token");
    doubles.hasher.verify
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);

    await service.login("admin", "wrong");
    await service.login("admin", "wrong");
    await expect(service.login("admin", "correct")).resolves.not.toBeNull();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(service.login("admin", "wrong")).resolves.toBeNull();
    }
  });

  it("limits attempts per client address across usernames", async () => {
    const limited = new AuthService(
      doubles.users,
      doubles.session,
      doubles.hasher,
      new LoginThrottle({ maxFailuresPerAddress: 2 }),
    );
    doubles.users.findCredentialsByUsername.mockResolvedValue(null);
    doubles.hasher.hash.mockResolvedValue("decoy-hash");
    doubles.hasher.verify.mockResolvedValue(false);

    await limited.login("first", "wrong", null, "203.0.113.7");
    await limited.login("second", "wrong", null, "203.0.113.7");

    await expect(
      limited.login("third", "wrong", null, "203.0.113.7"),
    ).rejects.toBeInstanceOf(TooManyLoginAttemptsError);
    await expect(
      limited.login("third", "wrong", null, "198.51.100.9"),
    ).resolves.toBeNull();
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
