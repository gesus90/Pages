import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionService } from "@/backend/auth/SessionService";

import type { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import type { UserService } from "@/backend/service/UserService";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A session repository whose methods are `vi.fn()` spies. */
type RepositoryDouble = {
  [Method in keyof SessionRepository]: ReturnType<typeof vi.fn>;
} & SessionRepository;

function createRepository(): RepositoryDouble {
  return {
    deleteAllByUserId: vi.fn(),
    deleteAllExceptTokenHash: vi.fn(),
    deleteByIdAndUserId: vi.fn(),
    deleteExpired: vi.fn(),
    findTokenHashByIdAndUserId: vi.fn(),
    listActiveByUserId: vi.fn(),
  } as unknown as RepositoryDouble;
}

describe("SessionService session management", () => {
  let repository: RepositoryDouble;
  let service: SessionService;

  beforeEach(() => {
    repository = createRepository();
    service = new SessionService(repository, {} as UserService);
  });

  describe("getSessionSummaries", () => {
    it("describes the sessions of a user with their devices", async () => {
      repository.listActiveByUserId.mockResolvedValue([
        {
          createdAt: "2026-10-01 08:00:00",
          id: "session-1",
          isCurrent: true,
          lastUsedAt: "2026-10-04 09:00:00",
          userAgent:
            "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
        },
        {
          createdAt: "2026-09-20 08:00:00",
          id: "session-2",
          isCurrent: false,
          lastUsedAt: "2026-09-21 09:00:00",
          userAgent: null,
        },
      ]);

      const summaries = await service.getSessionSummaries("user-1", "token");

      expect(summaries).toEqual([
        {
          browser: "Firefox 130",
          createdAt: "2026-10-01 08:00:00",
          id: "session-1",
          isCurrent: true,
          lastUsedAt: "2026-10-04 09:00:00",
          operatingSystem: "Linux",
        },
        {
          browser: null,
          createdAt: "2026-09-20 08:00:00",
          id: "session-2",
          isCurrent: false,
          lastUsedAt: "2026-09-21 09:00:00",
          operatingSystem: null,
        },
      ]);
      expect(repository.listActiveByUserId).toHaveBeenCalledWith(
        "user-1",
        hashToken("token"),
      );
    });

    it("marks no session as current without a token", async () => {
      repository.listActiveByUserId.mockResolvedValue([]);

      await service.getSessionSummaries("user-1", null);

      expect(repository.listActiveByUserId).toHaveBeenCalledWith("user-1", "");
    });
  });

  describe("revokeSessionById", () => {
    it("revokes another session of the same user", async () => {
      repository.findTokenHashByIdAndUserId.mockResolvedValue(
        hashToken("other-token"),
      );

      await expect(
        service.revokeSessionById("user-1", "session-2", "current-token"),
      ).resolves.toBe(true);
      expect(repository.deleteByIdAndUserId).toHaveBeenCalledWith(
        "session-2",
        "user-1",
      );
    });

    it("never revokes the session of the requesting browser", async () => {
      repository.findTokenHashByIdAndUserId.mockResolvedValue(
        hashToken("current-token"),
      );

      await expect(
        service.revokeSessionById("user-1", "session-1", "current-token"),
      ).resolves.toBe(false);
      expect(repository.deleteByIdAndUserId).not.toHaveBeenCalled();
    });

    it("reports sessions that do not exist or belong to someone else", async () => {
      repository.findTokenHashByIdAndUserId.mockResolvedValue(null);

      await expect(
        service.revokeSessionById("user-1", "missing", "current-token"),
      ).resolves.toBe(false);
      expect(repository.deleteByIdAndUserId).not.toHaveBeenCalled();
    });
  });

  it("revokes every other session of a user", async () => {
    await service.revokeOtherSessions("user-1", "current-token");

    expect(repository.deleteAllExceptTokenHash).toHaveBeenCalledWith(
      "user-1",
      hashToken("current-token"),
    );
  });

  it("revokes every session when the browser has no token", async () => {
    await service.revokeOtherSessions("user-1", null);

    expect(repository.deleteAllExceptTokenHash).toHaveBeenCalledWith(
      "user-1",
      "",
    );
  });

  it("revokes every session of a user", async () => {
    await service.revokeAllSessions("user-1");

    expect(repository.deleteAllByUserId).toHaveBeenCalledWith("user-1");
  });

  it("removes expired sessions", async () => {
    await service.removeExpiredSessions();

    expect(repository.deleteExpired).toHaveBeenCalledTimes(1);
  });
});
