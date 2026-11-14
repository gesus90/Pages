import { describe, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import {
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_DRIVE_FULL_SCOPE,
} from "@/backend/google/GoogleDriveConfig";
import { GoogleDriveConnectionService } from "@/backend/service/google/GoogleDriveConnectionService";

import type { GoogleDriveRepository } from "@/backend/database/repositories/google/GoogleDriveRepository";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { GoogleDriveRuntime } from "@/backend/service/google/GoogleDriveConnectionService";

const ORIGIN = "https://pages.example.test";
const callback = { baseUrl: ORIGIN, state: "state", code: "code", error: null };
const attempt = {
  id: "attempt",
  stateHash: "hash",
  userId: "admin",
  redirectUri: `${ORIGIN}/settings-api/google-drive/callback`,
  codeVerifierSecret: "sealed",
  createdAt: 1,
  expiresAt: 10000,
  consumedAt: null,
  requestedAccess: "read" as const,
};
const connection = {
  connectedAt: 1,
  connectedByUserId: "admin",
  googleEmail: "old@example.test",
  googlePermissionId: "permission",
  grantedScope: GOOGLE_DRIVE_SCOPE,
  reauthorizationReason: null,
  refreshTokenSecret: "sealed",
};

interface Fixture {
  service: GoogleDriveConnectionService;
  repository: {
    insertAttempt: Mock;
    claimAttempt: Mock;
    findAttemptByStateHash: Mock;
    findConnection: Mock;
    saveConnection: Mock;
    recordRefresh: Mock;
    recordVerification: Mock;
    requireReauthorization: Mock;
  };
  cipher: { encrypt: Mock; decrypt: Mock };
  client: { exchangeCode: Mock; refresh: Mock; readAccount: Mock };
}

function fixture(): Fixture {
  const repository = {
    insertAttempt: vi.fn(),
    claimAttempt: vi.fn().mockResolvedValue(attempt),
    findAttemptByStateHash: vi.fn().mockResolvedValue(null),
    findConnection: vi.fn().mockResolvedValue(connection),
    saveConnection: vi.fn(),
    recordRefresh: vi.fn().mockResolvedValue(true),
    recordVerification: vi.fn(),
    requireReauthorization: vi.fn(),
  };
  const cipher = {
    encrypt: vi.fn((binding: string, value: string) => `${binding}:${value}`),
    decrypt: vi.fn().mockReturnValue("secret"),
  };
  const client = {
    exchangeCode: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: 1000000,
        grantedScopes: [GOOGLE_DRIVE_SCOPE],
      },
    }),
    refresh: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        accessToken: "renewed",
        refreshToken: null,
        expiresAt: 1000000,
      },
    }),
    readAccount: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        permissionId: "permission",
        emailAddress: "drive@example.test",
      },
    }),
  };
  const service = new GoogleDriveConnectionService({
    repository: repository as unknown as GoogleDriveRepository,
    cipher: cipher as unknown as InstanceSecretCipher,
    runtime: {
      application: { clientId: "client" },
      client: client as unknown as GoogleDriveRuntime["client"],
    },
    missingSettings: [],
    now: () => 1000,
  });
  return { service, repository, cipher, client };
}

describe("Google Drive connection lifecycle", () => {
  it("starts PKCE sign-in and stores a user-bound attempt", async () => {
    const { service, repository } = fixture();
    const link = await service.start({
      userId: "admin",
      baseUrl: ORIGIN,
      access: "write",
    });
    expect(link).not.toBeNull();
    const url = new URL(link ?? "");
    expect(url.searchParams.get("client_id")).toBe("client");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(repository.insertAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "admin",
        requestedAccess: "write",
        expiresAt: 901000,
        redirectUri: attempt.redirectUri,
      }),
    );
  });

  it("rejects invalid, expired and denied callbacks before exchanging a code", async () => {
    const { service, repository, client } = fixture();
    expect(await service.complete("admin", { ...callback, state: null })).toBe(
      "invalid",
    );
    repository.claimAttempt.mockResolvedValueOnce(null);
    repository.findAttemptByStateHash.mockResolvedValueOnce({
      ...attempt,
      expiresAt: 1000,
    });
    expect(await service.complete("admin", callback)).toBe("expired");
    expect(
      await service.complete("admin", {
        ...callback,
        baseUrl: "https://other.test",
      }),
    ).toBe("invalid");
    expect(
      await service.complete("admin", { ...callback, error: "access_denied" }),
    ).toBe("denied");
    expect(await service.complete("admin", { ...callback, code: null })).toBe(
      "failed",
    );
    expect(client.exchangeCode).not.toHaveBeenCalled();
  });

  it("saves verified credentials and uses the cached access token", async () => {
    const { service, repository, client } = fixture();
    expect(await service.complete("admin", callback)).toBe("connected");
    expect(repository.saveConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        googlePermissionId: "permission",
        refreshTokenSecret: "google-drive:refresh:1000:refresh",
        connectedAt: 1000,
      }),
    );
    repository.findConnection.mockResolvedValue({
      ...connection,
      connectedAt: 1000,
    });
    expect(await service.access()).toMatchObject({
      ok: true,
      accessToken: "access",
      permissionId: "permission",
    });
    expect(client.refresh).not.toHaveBeenCalled();
    expect(repository.recordVerification).toHaveBeenCalled();
  });
});

describe("Google Drive connection verification", () => {
  it("refuses incomplete grants and write consent for another account", async () => {
    const { service, repository, client } = fixture();
    client.exchangeCode.mockResolvedValueOnce({
      ok: true,
      value: {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: 1000000,
        grantedScopes: [],
      },
    });
    expect(await service.complete("admin", callback)).toBe("scope_missing");
    repository.claimAttempt.mockResolvedValue({
      ...attempt,
      requestedAccess: "write",
    });
    expect(await service.complete("admin", callback)).toBe("write_declined");
    client.exchangeCode.mockResolvedValueOnce({
      ok: true,
      value: {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: 1000000,
        grantedScopes: [GOOGLE_DRIVE_SCOPE, GOOGLE_DRIVE_FULL_SCOPE],
      },
    });
    repository.findConnection.mockResolvedValue({
      ...connection,
      googlePermissionId: "other",
    });
    expect(await service.complete("admin", callback)).toBe("account_mismatch");
    expect(repository.saveConnection).not.toHaveBeenCalled();
  });

  it("renews once, verifies the account and marks a changed account for sign-in", async () => {
    const { service, repository, client } = fixture();
    expect(await service.access()).toMatchObject({
      ok: true,
      accessToken: "renewed",
    });
    expect(repository.recordRefresh).toHaveBeenCalledWith({
      connectedAt: 1,
      now: 1000,
      refreshTokenSecret: null,
    });
    client.readAccount.mockResolvedValueOnce({
      ok: true,
      value: { permissionId: "different", emailAddress: null },
    });
    expect(await service.access()).toEqual({
      ok: false,
      problem: "account_changed",
      state: "reauthorization_required",
    });
    expect(repository.requireReauthorization).toHaveBeenCalledWith({
      connectedAt: 1,
      reason: "account_changed",
    });
    expect(client.refresh).toHaveBeenCalledTimes(1);
  });

  it("marks an unreadable refresh secret for reauthorization", async () => {
    const { service, cipher, repository, client } = fixture();
    cipher.decrypt.mockImplementation(() => {
      throw new Error("invalid secret");
    });
    expect(await service.access()).toEqual({
      ok: false,
      problem: "secret_unavailable",
      state: "reauthorization_required",
    });
    expect(repository.requireReauthorization).toHaveBeenCalledWith({
      connectedAt: 1,
      reason: "secret_unavailable",
    });
    expect(client.refresh).not.toHaveBeenCalled();
  });
});
