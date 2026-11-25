import { describe, expect, it, vi } from "vitest";

import {
  GOOGLE_DRIVE_FULL_SCOPE,
  GOOGLE_DRIVE_READ_SCOPE,
  GOOGLE_DRIVE_SCOPE,
} from "@/backend/google/GoogleDriveConfig";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";

import {
  GOOGLE_DRIVE_CALLBACK_PATH,
  GoogleDriveConnectionService,
} from "./GoogleDriveConnectionService";

import type {
  GoogleDriveRepository,
  StoredGoogleDriveConnection,
} from "@/backend/database/repositories/google/GoogleDriveRepository";
import type {
  GoogleCallResult,
  GoogleDriveAccount,
  GoogleTokenGrant,
} from "@/backend/google/GoogleDriveApiClient";
import type { Mock } from "vitest";
import type { GoogleDriveOrigins } from "./GoogleDriveConnectionService";

const logger = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => logger);

const NOW = 1_000_000;
const cipher = new InstanceSecretCipher(Buffer.alloc(32, 9));
const ORIGINS: GoogleDriveOrigins = {
  allowed: ["https://a.example", "https://b.example"],
  current: "https://a.example",
};

function connectionOf(
  overrides: Partial<StoredGoogleDriveConnection> = {},
): StoredGoogleDriveConnection {
  const connectedAt = overrides.connectedAt ?? 5;

  return {
    googlePermissionId: "perm",
    googleEmail: "stored@example.com",
    refreshTokenSecret: cipher.encrypt(
      `google-drive:refresh:${connectedAt}`,
      "stored-refresh",
    ),
    grantedScope: `${GOOGLE_DRIVE_SCOPE} ${GOOGLE_DRIVE_FULL_SCOPE}`,
    connectedByUserId: "admin",
    connectedAt,
    reauthorizationReason: null,
    ...overrides,
  };
}

function grantOf(overrides: Partial<GoogleTokenGrant> = {}): GoogleTokenGrant {
  return {
    accessToken: "renewed",
    expiresAt: NOW + 3_600_000,
    refreshToken: null,
    grantedScopes: [],
    ...overrides,
  };
}

function accountOk(
  permissionId = "perm",
): GoogleCallResult<GoogleDriveAccount> {
  return {
    ok: true,
    value: { permissionId, emailAddress: "live@example.com" },
  };
}

interface Setup {
  readonly repository: {
    readonly findConnection: Mock<
      () => Promise<StoredGoogleDriveConnection | null>
    >;
    readonly recordRefresh: Mock<() => Promise<boolean>>;
    readonly recordVerification: Mock<() => Promise<void>>;
    readonly requireReauthorization: Mock<() => Promise<void>>;
  };
  readonly client: {
    readonly exchangeCode: Mock<() => Promise<never>>;
    readonly refresh: Mock<() => Promise<GoogleCallResult<GoogleTokenGrant>>>;
    readonly readAccount: Mock<
      () => Promise<GoogleCallResult<GoogleDriveAccount>>
    >;
  };
  readonly service: GoogleDriveConnectionService;
}

function setup(hasRuntime = true): Setup {
  const repository = {
    findConnection: vi.fn(
      async (): Promise<StoredGoogleDriveConnection | null> => connectionOf(),
    ),
    recordRefresh: vi.fn(async () => true),
    recordVerification: vi.fn(async () => undefined),
    requireReauthorization: vi.fn(async () => undefined),
  };
  const client = {
    exchangeCode: vi.fn<() => Promise<never>>(),
    refresh: vi.fn(async (): Promise<GoogleCallResult<GoogleTokenGrant>> => ({
      ok: true,
      value: grantOf(),
    })),
    readAccount: vi.fn(async () => accountOk()),
  };
  const service = new GoogleDriveConnectionService({
    repository: repository as unknown as GoogleDriveRepository,
    cipher,
    runtime: hasRuntime
      ? { application: { clientId: "client" }, client }
      : null,
    missingSettings: ["GOOGLE_CLIENT_ID"],
    now: () => NOW,
  });

  return { repository, client, service };
}

describe("GoogleDriveConnectionService.getStatus", () => {
  it("reports a missing OAuth client with the redirect URIs", async () => {
    const { service } = setup(false);

    await expect(service.getStatus(ORIGINS)).resolves.toEqual({
      accountEmail: null,
      canSignIn: true,
      isSimulation: false,
      missingSettings: ["GOOGLE_CLIENT_ID"],
      needsFolderAccess: false,
      needsWriteAccess: false,
      problem: null,
      redirectUris: [
        `https://a.example${GOOGLE_DRIVE_CALLBACK_PATH}`,
        `https://b.example${GOOGLE_DRIVE_CALLBACK_PATH}`,
      ],
      state: "not_configured",
    });
  });

  it("reports a disconnected instance and an origin that may not sign in", async () => {
    const { service, repository } = setup();
    repository.findConnection.mockResolvedValue(null);

    const status = await service.getStatus({ allowed: [], current: null });

    expect(status.state).toBe("disconnected");
    expect(status.canSignIn).toBe(false);
  });

  it("reports a stored reauthorization reason without asking Drive", async () => {
    const { service, repository, client } = setup();
    repository.findConnection.mockResolvedValue(
      connectionOf({ reauthorizationReason: "scope_missing" }),
    );

    const status = await service.getStatus(ORIGINS);

    expect(status).toMatchObject({
      problem: "scope_missing",
      state: "reauthorization_required",
    });
    expect(client.readAccount).not.toHaveBeenCalled();
  });
});

describe("GoogleDriveConnectionService.getStatus connected", () => {
  it("reports a connection Drive just confirmed", async () => {
    const { service, repository } = setup();

    const status = await service.getStatus(ORIGINS);

    expect(status).toMatchObject({
      accountEmail: "live@example.com",
      needsFolderAccess: false,
      needsWriteAccess: false,
      problem: null,
      state: "connected",
    });
    expect(repository.recordVerification).toHaveBeenCalledWith({
      connectedAt: 5,
      googleEmail: "live@example.com",
      now: NOW,
    });
  });

  it("asks for folder and write access when only the file scope was granted", async () => {
    const { service, repository } = setup();
    repository.findConnection.mockResolvedValue(
      connectionOf({ grantedScope: GOOGLE_DRIVE_SCOPE }),
    );

    await expect(service.getStatus(ORIGINS)).resolves.toMatchObject({
      needsFolderAccess: true,
      needsWriteAccess: true,
    });
  });

  it("asks only for write access when the read scope was granted", async () => {
    const { service, repository } = setup();
    repository.findConnection.mockResolvedValue(
      connectionOf({ grantedScope: GOOGLE_DRIVE_READ_SCOPE }),
    );

    await expect(service.getStatus(ORIGINS)).resolves.toMatchObject({
      needsFolderAccess: false,
      needsWriteAccess: true,
    });
  });

  it("marks the connection for a new sign-in when Google revoked it", async () => {
    const { service, repository, client } = setup();
    client.readAccount.mockResolvedValue({
      ok: false,
      problem: "access_revoked",
    });

    await expect(service.getStatus(ORIGINS)).resolves.toMatchObject({
      problem: "access_revoked",
      state: "reauthorization_required",
    });
    expect(repository.requireReauthorization).toHaveBeenCalledWith({
      connectedAt: 5,
      reason: "access_revoked",
    });
  });

  it("calls a Google outage unavailable without marking the connection", async () => {
    const { service, repository, client } = setup();
    client.readAccount.mockResolvedValue({
      ok: false,
      problem: "google_unreachable",
    });

    await expect(service.getStatus(ORIGINS)).resolves.toMatchObject({
      problem: "google_unreachable",
      state: "unavailable",
    });
    expect(repository.requireReauthorization).not.toHaveBeenCalled();
    expect(logger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "google_drive.verification_failed" }),
    );
  });
});

describe("GoogleDriveConnectionService.getStatus problems", () => {
  it("detects another Google account behind the tokens", async () => {
    const { service, repository, client } = setup();
    client.readAccount.mockResolvedValue(accountOk("intruder"));

    await expect(service.getStatus(ORIGINS)).resolves.toMatchObject({
      problem: "account_changed",
      state: "reauthorization_required",
    });
    expect(repository.requireReauthorization).toHaveBeenCalledWith({
      connectedAt: 5,
      reason: "account_changed",
    });
  });
});

describe("GoogleDriveConnectionService.access refusals", () => {
  it("reports a missing OAuth client", async () => {
    const { service } = setup(false);

    await expect(service.access()).resolves.toEqual({
      ok: false,
      problem: null,
      state: "not_configured",
    });
  });

  it("reports a disconnected instance", async () => {
    const { service, repository } = setup();
    repository.findConnection.mockResolvedValue(null);

    await expect(service.access()).resolves.toEqual({
      ok: false,
      problem: null,
      state: "disconnected",
    });
  });

  it("reports a stored reauthorization reason", async () => {
    const { service, repository } = setup();
    repository.findConnection.mockResolvedValue(
      connectionOf({ reauthorizationReason: "account_changed" }),
    );

    await expect(service.access()).resolves.toEqual({
      ok: false,
      problem: "account_changed",
      state: "reauthorization_required",
    });
  });
});

describe("GoogleDriveConnectionService.access", () => {
  it("renews the token and returns the verified access", async () => {
    const { service, client } = setup();

    await expect(service.access()).resolves.toEqual({
      accessToken: "renewed",
      accountEmail: "live@example.com",
      grantedScopes: [GOOGLE_DRIVE_SCOPE, GOOGLE_DRIVE_FULL_SCOPE],
      ok: true,
      permissionId: "perm",
    });
    expect(client.refresh).toHaveBeenCalledWith("stored-refresh");
    expect(client.readAccount).toHaveBeenCalledWith("renewed");
  });

  it("maps a refused verification to its state", async () => {
    const { service, client } = setup();
    client.readAccount.mockResolvedValue({
      ok: false,
      problem: "scope_missing",
    });

    await expect(service.access()).resolves.toEqual({
      ok: false,
      problem: "scope_missing",
      state: "reauthorization_required",
    });
  });

  it("calls the connection unavailable when the token was not kept", async () => {
    const { service, repository } = setup();
    repository.recordRefresh.mockResolvedValue(false);

    await expect(service.access()).resolves.toEqual({
      ok: false,
      problem: "google_unreachable",
      state: "unavailable",
    });
  });
});

describe("GoogleDriveConnectionService token handling", () => {
  it("reuses a cached access token until shortly before it expires", async () => {
    const { service, client } = setup();

    await service.access();
    await service.access();

    expect(client.refresh).toHaveBeenCalledTimes(1);
    expect(client.readAccount).toHaveBeenCalledTimes(2);
    expect(client.readAccount).toHaveBeenLastCalledWith("renewed");
  });

  it("renews a token inside the renewal margin", async () => {
    const { service, client } = setup();
    client.refresh.mockResolvedValue({
      ok: true,
      value: grantOf({ expiresAt: NOW + 30_000 }),
    });

    await service.access();
    await service.access();

    expect(client.refresh).toHaveBeenCalledTimes(2);
  });

  it("renews a token that belongs to an earlier connection", async () => {
    const { service, repository, client } = setup();

    await service.access();
    repository.findConnection.mockResolvedValue(
      connectionOf({ connectedAt: 6 }),
    );
    await service.access();

    expect(client.refresh).toHaveBeenCalledTimes(2);
  });

  it("renews once when Drive refuses the cached token", async () => {
    const { service, client } = setup();
    await service.access();
    client.readAccount
      .mockResolvedValueOnce({ ok: false, problem: "access_revoked" })
      .mockResolvedValueOnce(accountOk());

    await expect(service.access()).resolves.toMatchObject({ ok: true });
    expect(client.refresh).toHaveBeenCalledTimes(2);
  });

  it("returns another refusal of the cached token as it is", async () => {
    const { service, client } = setup();
    await service.access();
    client.readAccount.mockResolvedValueOnce({
      ok: false,
      problem: "google_unreachable",
    });

    await expect(service.access()).resolves.toMatchObject({
      problem: "google_unreachable",
      state: "unavailable",
    });
    expect(client.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("GoogleDriveConnectionService renewal", () => {
  it("shares one renewal between concurrent requests", async () => {
    const { service, client } = setup();

    await Promise.all([service.access(), service.access()]);

    expect(client.refresh).toHaveBeenCalledTimes(1);
  });

  it("stores a rotated refresh token encrypted", async () => {
    const { service, repository, client } = setup();
    client.refresh.mockResolvedValue({
      ok: true,
      value: grantOf({ refreshToken: "rotated" }),
    });

    await service.access();

    const call = repository.recordRefresh.mock.calls[0] as unknown as [
      { refreshTokenSecret: string | null },
    ];
    expect(
      cipher.decrypt(
        "google-drive:refresh:5",
        call[0].refreshTokenSecret ?? "",
      ),
    ).toBe("rotated");
    expect(logger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "google_drive.access_token_renewed",
        metadata: { kind: "rotated", durationMs: 3_600_000 },
      }),
    );
  });

  it("keeps the stored refresh token when Google sends no new one", async () => {
    const { service, repository } = setup();

    await service.access();

    expect(repository.recordRefresh).toHaveBeenCalledWith({
      connectedAt: 5,
      now: NOW,
      refreshTokenSecret: null,
    });
  });

  it("passes on a refused renewal", async () => {
    const { service, repository, client } = setup();
    client.refresh.mockResolvedValue({ ok: false, problem: "access_revoked" });

    await expect(service.access()).resolves.toMatchObject({
      problem: "access_revoked",
      state: "reauthorization_required",
    });
    expect(repository.requireReauthorization).toHaveBeenCalledTimes(1);
  });

  it("requires a new sign-in when the refresh token cannot be decrypted", async () => {
    const { service, repository, client } = setup();
    repository.findConnection.mockResolvedValue(
      connectionOf({ refreshTokenSecret: "garbage" }),
    );

    await expect(service.access()).resolves.toEqual({
      ok: false,
      problem: "secret_unavailable",
      state: "reauthorization_required",
    });
    expect(client.refresh).not.toHaveBeenCalled();
    expect(logger.logCaughtError).toHaveBeenCalled();
  });
});
