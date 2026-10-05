import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthService } from "@/backend/auth/AuthService";
import { LoginThrottle } from "@/backend/auth/LoginThrottle";

import { createUser } from "../helpers/factories";

import type { PasswordHasher } from "@/backend/auth/PasswordHasher";
import type { SessionService } from "@/backend/auth/SessionService";
import type { UserService } from "@/backend/service/UserService";

interface Doubles {
  hasher: PasswordHasher & {
    hash: ReturnType<typeof vi.fn>;
    verify: ReturnType<typeof vi.fn>;
  };
  sessions: SessionService & {
    revokeOtherSessions: ReturnType<typeof vi.fn>;
  };
  users: UserService & {
    findCredentialsByUsername: ReturnType<typeof vi.fn>;
    updatePasswordHash: ReturnType<typeof vi.fn>;
  };
}

function createDoubles(): Doubles {
  return {
    hasher: { hash: vi.fn(), verify: vi.fn() } as unknown as Doubles["hasher"],
    sessions: {
      revokeOtherSessions: vi.fn().mockResolvedValue(undefined),
    } as unknown as Doubles["sessions"],
    users: {
      findCredentialsByUsername: vi.fn(),
      updatePasswordHash: vi.fn(),
    } as unknown as Doubles["users"],
  };
}

describe("AuthService.changePassword", () => {
  let doubles: Doubles;
  let service: AuthService;

  beforeEach(() => {
    doubles = createDoubles();
    service = new AuthService(
      doubles.users,
      doubles.sessions,
      doubles.hasher,
      new LoginThrottle(),
    );
    doubles.users.findCredentialsByUsername.mockResolvedValue({
      passwordHash: "stored-hash",
      user: createUser(),
    });
  });

  it("replaces the hash after verifying the current password", async () => {
    doubles.hasher.verify.mockResolvedValue(true);
    doubles.hasher.hash.mockResolvedValue("new-hash");

    await expect(
      service.changePassword(
        "admin",
        "old-password",
        "new-password",
        "browser-token",
      ),
    ).resolves.toBe("success");

    expect(doubles.hasher.verify).toHaveBeenCalledWith(
      "stored-hash",
      "old-password",
    );
    expect(doubles.hasher.hash).toHaveBeenCalledWith("new-password");
    expect(doubles.users.updatePasswordHash).toHaveBeenCalledWith(
      "user-1",
      "new-hash",
    );
  });

  it("revokes the other sessions but keeps the requesting browser", async () => {
    doubles.hasher.verify.mockResolvedValue(true);
    doubles.hasher.hash.mockResolvedValue("new-hash");

    await service.changePassword(
      "admin",
      "old-password",
      "new-password",
      "browser-token",
    );

    expect(doubles.sessions.revokeOtherSessions).toHaveBeenCalledWith(
      "user-1",
      "browser-token",
    );
  });

  it("rejects a wrong current password without changing anything", async () => {
    doubles.hasher.verify.mockResolvedValue(false);

    await expect(
      service.changePassword("admin", "wrong", "new-password", "browser-token"),
    ).resolves.toBe("invalidCurrent");

    expect(doubles.hasher.hash).not.toHaveBeenCalled();
    expect(doubles.users.updatePasswordHash).not.toHaveBeenCalled();
    expect(doubles.sessions.revokeOtherSessions).not.toHaveBeenCalled();
  });

  it("rejects an unknown user as an invalid current password", async () => {
    doubles.users.findCredentialsByUsername.mockResolvedValue(null);

    await expect(
      service.changePassword(
        "ghost",
        "old-password",
        "new-password",
        "browser-token",
      ),
    ).resolves.toBe("invalidCurrent");

    expect(doubles.hasher.verify).not.toHaveBeenCalled();
  });

  it("refuses to set the same password again", async () => {
    doubles.hasher.verify.mockResolvedValue(true);

    await expect(
      service.changePassword(
        "admin",
        "same-password",
        "same-password",
        "browser-token",
      ),
    ).resolves.toBe("unchanged");

    expect(doubles.users.updatePasswordHash).not.toHaveBeenCalled();
    expect(doubles.sessions.revokeOtherSessions).not.toHaveBeenCalled();
  });

  it("propagates storage failures", async () => {
    doubles.hasher.verify.mockResolvedValue(true);
    doubles.hasher.hash.mockResolvedValue("new-hash");
    doubles.users.updatePasswordHash.mockRejectedValue(
      new Error("Write failed"),
    );

    await expect(
      service.changePassword(
        "admin",
        "old-password",
        "new-password",
        "browser-token",
      ),
    ).rejects.toThrow("Write failed");
    expect(doubles.sessions.revokeOtherSessions).not.toHaveBeenCalled();
  });
});
