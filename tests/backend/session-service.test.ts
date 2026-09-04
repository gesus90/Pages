import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_LIFETIME_DAYS,
  SESSION_LIFETIME_SECONDS,
  SessionService,
} from "@/backend/auth/SessionService";

import type { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import type { UserService } from "@/backend/service/UserService";
import type { User } from "@/definition/User";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createDoubles(): {
  repository: SessionRepository & {
    deleteByTokenHash: ReturnType<typeof vi.fn>;
    deleteExpired: ReturnType<typeof vi.fn>;
    findUserIdByTokenHash: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    markUsed: ReturnType<typeof vi.fn>;
  };
  users: UserService & { getById: ReturnType<typeof vi.fn> };
} {
  return {
    repository: {
      deleteByTokenHash: vi.fn(),
      deleteExpired: vi.fn(),
      findUserIdByTokenHash: vi.fn(),
      insert: vi.fn(),
      markUsed: vi.fn(),
    } as unknown as SessionRepository & {
      deleteByTokenHash: ReturnType<typeof vi.fn>;
      deleteExpired: ReturnType<typeof vi.fn>;
      findUserIdByTokenHash: ReturnType<typeof vi.fn>;
      insert: ReturnType<typeof vi.fn>;
      markUsed: ReturnType<typeof vi.fn>;
    },
    users: {
      createUser: vi.fn(),
      findCredentialsByUsername: vi.fn(),
      getById: vi.fn(),
    } as unknown as UserService & { getById: ReturnType<typeof vi.fn> },
  };
}

describe("SessionService", () => {
  let doubles: ReturnType<typeof createDoubles>;
  let service: SessionService;

  beforeEach(() => {
    doubles = createDoubles();
    service = new SessionService(doubles.repository, doubles.users);
  });

  it("exposes a thirty-day session lifetime", () => {
    expect(SESSION_LIFETIME_DAYS).toBe(30);
    expect(SESSION_LIFETIME_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it("creates a session and stores only its hash", async () => {
    doubles.repository.insert.mockResolvedValue(undefined);

    const token = await service.createSession("user-1");

    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
    expect(doubles.repository.insert).toHaveBeenCalledTimes(1);

    const inserted = doubles.repository.insert.mock.calls[0]?.[0] as {
      id: string;
      lifetimeDays: number;
      tokenHash: string;
      userId: string;
    };

    expect(inserted.userId).toBe("user-1");
    expect(inserted.lifetimeDays).toBe(SESSION_LIFETIME_DAYS);
    expect(inserted.tokenHash).toBe(hashToken(token));
    expect(inserted.tokenHash).not.toContain(token);
    expect(typeof inserted.id).toBe("string");
  });

  it("creates unique tokens for consecutive sessions", async () => {
    doubles.repository.insert.mockResolvedValue(undefined);

    const first = await service.createSession("user-1");
    const second = await service.createSession("user-1");

    expect(first).not.toBe(second);
  });

  it("authenticates a token and records its use", async () => {
    const user: User = {
      displayName: "Admin",
      id: "user-1",
      username: "admin",
    };
    doubles.repository.findUserIdByTokenHash.mockResolvedValue("user-1");
    doubles.users.getById.mockResolvedValue(user);
    doubles.repository.markUsed.mockResolvedValue(undefined);

    const authenticated = await service.authenticate("session-token");

    expect(authenticated).toBe(user);
    expect(doubles.repository.findUserIdByTokenHash).toHaveBeenCalledWith(
      hashToken("session-token"),
    );
    expect(doubles.users.getById).toHaveBeenCalledWith("user-1");
    expect(doubles.repository.markUsed).toHaveBeenCalledWith(
      hashToken("session-token"),
    );
  });

  it("returns null for missing tokens without touching persistence", async () => {
    await expect(service.authenticate(null)).resolves.toBeNull();
    await expect(service.authenticate("")).resolves.toBeNull();

    expect(doubles.repository.findUserIdByTokenHash).not.toHaveBeenCalled();
    expect(doubles.users.getById).not.toHaveBeenCalled();
  });

  it("returns null for unknown token hashes", async () => {
    doubles.repository.findUserIdByTokenHash.mockResolvedValue(null);

    await expect(service.authenticate("unknown")).resolves.toBeNull();

    expect(doubles.users.getById).not.toHaveBeenCalled();
    expect(doubles.repository.markUsed).not.toHaveBeenCalled();
  });

  it("returns null when the session owner no longer exists", async () => {
    doubles.repository.findUserIdByTokenHash.mockResolvedValue("user-1");
    doubles.users.getById.mockResolvedValue(null);

    await expect(service.authenticate("token")).resolves.toBeNull();

    expect(doubles.repository.markUsed).not.toHaveBeenCalled();
  });

  it("revokes a token by deleting its hash", async () => {
    doubles.repository.deleteByTokenHash.mockResolvedValue(undefined);

    await service.revoke("session-token");

    expect(doubles.repository.deleteByTokenHash).toHaveBeenCalledTimes(1);
    expect(doubles.repository.deleteByTokenHash).toHaveBeenCalledWith(
      hashToken("session-token"),
    );
  });

  it("ignores missing tokens when revoking", async () => {
    await service.revoke(null);
    await service.revoke("");

    expect(doubles.repository.deleteByTokenHash).not.toHaveBeenCalled();
  });

  it("removes expired sessions", async () => {
    doubles.repository.deleteExpired.mockResolvedValue(undefined);

    await service.removeExpiredSessions();

    expect(doubles.repository.deleteExpired).toHaveBeenCalledTimes(1);
  });

  it("propagates persistence failures", async () => {
    doubles.repository.insert.mockRejectedValue(new Error("Insert failed"));

    await expect(service.createSession("user-1")).rejects.toThrow(
      "Insert failed",
    );

    doubles.repository.findUserIdByTokenHash.mockRejectedValue(
      new Error("Lookup failed"),
    );

    await expect(service.authenticate("token")).rejects.toThrow(
      "Lookup failed",
    );
  });
});
