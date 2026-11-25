import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  GOOGLE_DRIVE_FULL_SCOPE,
  GOOGLE_DRIVE_SCOPE,
} from "@/backend/google/GoogleDriveConfig";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";

import {
  GOOGLE_DRIVE_CALLBACK_PATH,
  GoogleDriveConnectionService,
} from "./GoogleDriveConnectionService";

import type {
  GoogleDriveRepository,
  GoogleDriveRequestedAccess,
  GoogleDriveSignInAttempt,
  StoredGoogleDriveConnection,
} from "@/backend/database/repositories/google/GoogleDriveRepository";
import type {
  GoogleCallResult,
  GoogleDriveAccount,
  GoogleTokenGrant,
} from "@/backend/google/GoogleDriveApiClient";
import type { Mock } from "vitest";
import type { GoogleDriveCallbackInput } from "./GoogleDriveConnectionService";

const logger = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => logger);

const NOW = 1_000_000;
const BASE_URL = "https://pages.example";
const REDIRECT_URI = `${BASE_URL}${GOOGLE_DRIVE_CALLBACK_PATH}`;
const cipher = new InstanceSecretCipher(Buffer.alloc(32, 7));

function attemptOf(
  overrides: Partial<GoogleDriveSignInAttempt> = {},
): GoogleDriveSignInAttempt {
  return {
    id: "attempt-1",
    stateHash: "hash",
    userId: "admin",
    redirectUri: REDIRECT_URI,
    codeVerifierSecret: cipher.encrypt(
      "google-drive:attempt:attempt-1",
      "the-verifier",
    ),
    createdAt: NOW - 1000,
    expiresAt: NOW + 1000,
    consumedAt: null,
    requestedAccess: "read",
    ...overrides,
  };
}

function grantOf(overrides: Partial<GoogleTokenGrant> = {}): GoogleTokenGrant {
  return {
    accessToken: "access",
    expiresAt: NOW + 3_600_000,
    refreshToken: "refresh",
    grantedScopes: [GOOGLE_DRIVE_SCOPE],
    ...overrides,
  };
}

function storedOf(permissionId: string): StoredGoogleDriveConnection {
  return {
    googlePermissionId: permissionId,
    googleEmail: null,
    refreshTokenSecret: "x",
    grantedScope: GOOGLE_DRIVE_SCOPE,
    connectedByUserId: "admin",
    connectedAt: 1,
    reauthorizationReason: null,
  };
}

interface Setup {
  readonly repository: {
    readonly insertAttempt: Mock<() => Promise<void>>;
    readonly claimAttempt: Mock<() => Promise<GoogleDriveSignInAttempt | null>>;
    readonly findAttemptByStateHash: Mock<
      () => Promise<GoogleDriveSignInAttempt | null>
    >;
    readonly findConnection: Mock<
      () => Promise<StoredGoogleDriveConnection | null>
    >;
    readonly saveConnection: Mock<() => Promise<void>>;
  };
  readonly client: {
    readonly exchangeCode: Mock<
      () => Promise<GoogleCallResult<GoogleTokenGrant>>
    >;
    readonly refresh: Mock<() => Promise<never>>;
    readonly readAccount: Mock<
      () => Promise<GoogleCallResult<GoogleDriveAccount>>
    >;
  };
  readonly service: GoogleDriveConnectionService;
}

function setup(hasRuntime = true): Setup {
  const repository = {
    insertAttempt: vi.fn(async () => undefined),
    claimAttempt: vi.fn(async (): Promise<GoogleDriveSignInAttempt | null> =>
      attemptOf(),
    ),
    findAttemptByStateHash: vi.fn(
      async (): Promise<GoogleDriveSignInAttempt | null> => null,
    ),
    findConnection: vi.fn(
      async (): Promise<StoredGoogleDriveConnection | null> => null,
    ),
    saveConnection: vi.fn(async () => undefined),
  };
  const client = {
    exchangeCode: vi.fn(
      async (): Promise<GoogleCallResult<GoogleTokenGrant>> => ({
        ok: true,
        value: grantOf(),
      }),
    ),
    refresh: vi.fn<() => Promise<never>>(),
    readAccount: vi.fn(
      async (): Promise<GoogleCallResult<GoogleDriveAccount>> => ({
        ok: true,
        value: { permissionId: "perm", emailAddress: "a@b.c" },
      }),
    ),
  };
  const service = new GoogleDriveConnectionService({
    repository: repository as unknown as GoogleDriveRepository,
    cipher,
    runtime: hasRuntime
      ? {
          application: { clientId: "client.apps.googleusercontent.com" },
          client,
        }
      : null,
    missingSettings: [],
    now: () => NOW,
  });

  return { repository, client, service };
}

function callbackOf(
  overrides: Partial<GoogleDriveCallbackInput> = {},
): GoogleDriveCallbackInput {
  return {
    baseUrl: BASE_URL,
    state: "the-state",
    code: "the-code",
    error: null,
    ...overrides,
  };
}

describe("GoogleDriveConnectionService.start", () => {
  it("returns null without an OAuth client", async () => {
    const { service, repository } = setup(false);

    await expect(
      service.start({ userId: "admin", baseUrl: BASE_URL }),
    ).resolves.toBeNull();
    expect(repository.insertAttempt).not.toHaveBeenCalled();
  });

  it.each<[GoogleDriveRequestedAccess | undefined, string, boolean]>([
    [undefined, "read", false],
    ["read", "read", false],
    ["write", "write", true],
  ])(
    "stores the attempt and builds the link for %s",
    async (access, stored, isWrite) => {
      const { service, repository } = setup();

      const link = await service.start({
        userId: "admin",
        baseUrl: BASE_URL,
        access,
      });

      expect(link).not.toBeNull();
      const url = new URL(link ?? "");
      const state = url.searchParams.get("state") ?? "";
      const call = repository.insertAttempt.mock.calls[0] as unknown as [
        GoogleDriveSignInAttempt,
      ];
      const attempt = call[0];
      expect(attempt.requestedAccess).toBe(stored);
      expect(attempt.redirectUri).toBe(REDIRECT_URI);
      expect(attempt.userId).toBe("admin");
      expect(attempt.createdAt).toBe(NOW);
      expect(attempt.expiresAt).toBe(NOW + 15 * 60 * 1000);
      expect(attempt.stateHash).toBe(
        createHash("sha256").update(state).digest("hex"),
      );
      const verifier = cipher.decrypt(
        `google-drive:attempt:${attempt.id}`,
        attempt.codeVerifierSecret,
      );
      expect(url.searchParams.get("code_challenge")).toBe(
        createHash("sha256").update(verifier).digest("base64url"),
      );
      expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
      expect(url.searchParams.get("include_granted_scopes")).toBe(
        String(isWrite),
      );
    },
  );
});

describe("GoogleDriveConnectionService.complete refusals", () => {
  it("reports a missing OAuth client", async () => {
    const { service } = setup(false);

    await expect(service.complete("admin", callbackOf())).resolves.toBe(
      "not_configured",
    );
  });

  it.each([
    ["no origin", { baseUrl: null }],
    ["no state", { state: null }],
    ["empty state", { state: "" }],
    ["long state", { state: "s".repeat(201) }],
  ])("refuses %s as invalid", async (label, overrides) => {
    const { service, repository } = setup();

    await expect(
      service.complete("admin", callbackOf(overrides)),
    ).resolves.toBe("invalid");
    expect(repository.claimAttempt).not.toHaveBeenCalled();
  });

  it("claims the attempt by the hashed state of the account", async () => {
    const { service, repository } = setup();

    await service.complete("admin", callbackOf());

    expect(repository.claimAttempt).toHaveBeenCalledWith({
      now: NOW,
      stateHash: createHash("sha256").update("the-state").digest("hex"),
      userId: "admin",
    });
  });

  it.each<[string, GoogleDriveSignInAttempt | null, string]>([
    ["unknown state", null, "invalid"],
    ["expired state", attemptOf({ expiresAt: NOW }), "expired"],
    [
      "spent state",
      attemptOf({ expiresAt: NOW, consumedAt: NOW - 1 }),
      "invalid",
    ],
    ["live state of another account", attemptOf(), "invalid"],
  ])("explains a refused %s", async (label, known, outcome) => {
    const { service, repository } = setup();
    repository.claimAttempt.mockResolvedValue(null);
    repository.findAttemptByStateHash.mockResolvedValue(known);

    await expect(service.complete("admin", callbackOf())).resolves.toBe(
      outcome,
    );
  });

  it("refuses another origin than the one the attempt started on", async () => {
    const { service } = setup();

    await expect(
      service.complete(
        "admin",
        callbackOf({ baseUrl: "https://other.example" }),
      ),
    ).resolves.toBe("invalid");
  });

  it("reports a denied consent", async () => {
    const { service } = setup();

    await expect(
      service.complete("admin", callbackOf({ error: "access_denied" })),
    ).resolves.toBe("denied");
  });

  it.each([
    ["no code", null],
    ["empty code", ""],
    ["long code", "c".repeat(2049)],
  ])("fails with %s", async (label, code) => {
    const { service, client } = setup();

    await expect(service.complete("admin", callbackOf({ code }))).resolves.toBe(
      "failed",
    );
    expect(client.exchangeCode).not.toHaveBeenCalled();
  });
});

describe("GoogleDriveConnectionService.complete exchange", () => {
  it("fails when the stored verifier cannot be decrypted", async () => {
    const { service, repository, client } = setup();
    repository.claimAttempt.mockResolvedValue(
      attemptOf({ codeVerifierSecret: "garbage" }),
    );

    await expect(service.complete("admin", callbackOf())).resolves.toBe(
      "failed",
    );
    expect(logger.logCaughtError).toHaveBeenCalled();
    expect(client.exchangeCode).not.toHaveBeenCalled();
  });

  it("fails when Google refuses the code", async () => {
    const { service, client } = setup();
    client.exchangeCode.mockResolvedValue({
      ok: false,
      problem: "client_invalid",
    });

    await expect(service.complete("admin", callbackOf())).resolves.toBe(
      "failed",
    );
    expect(client.exchangeCode).toHaveBeenCalledWith({
      code: "the-code",
      codeVerifier: "the-verifier",
      redirectUri: REDIRECT_URI,
    });
    expect(logger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "google_drive.sign_in_refused",
        metadata: { reason: "client_invalid" },
      }),
    );
  });

  it("reports a missing Drive scope", async () => {
    const { service, client } = setup();
    client.exchangeCode.mockResolvedValue({
      ok: true,
      value: grantOf({ grantedScopes: [] }),
    });

    await expect(service.complete("admin", callbackOf())).resolves.toBe(
      "scope_missing",
    );
  });

  it("fails without a refresh token", async () => {
    const { service, client } = setup();
    client.exchangeCode.mockResolvedValue({
      ok: true,
      value: grantOf({ refreshToken: null }),
    });

    await expect(service.complete("admin", callbackOf())).resolves.toBe(
      "failed",
    );
    expect(client.readAccount).not.toHaveBeenCalled();
  });

  it.each([
    ["scope_missing", "scope_missing"],
    ["google_unreachable", "failed"],
  ] as const)("maps an account check of %s to %s", async (problem, outcome) => {
    const { service, client } = setup();
    client.readAccount.mockResolvedValue({ ok: false, problem });

    await expect(service.complete("admin", callbackOf())).resolves.toBe(
      outcome,
    );
  });
});

describe("GoogleDriveConnectionService.complete connection", () => {
  const writeGrant = grantOf({
    grantedScopes: [GOOGLE_DRIVE_SCOPE, GOOGLE_DRIVE_FULL_SCOPE],
  });

  it("keeps the connection when a write consent was declined", async () => {
    const { service, repository } = setup();
    repository.claimAttempt.mockResolvedValue(
      attemptOf({ requestedAccess: "write" }),
    );

    await expect(service.complete("admin", callbackOf())).resolves.toBe(
      "write_declined",
    );
    expect(repository.saveConnection).not.toHaveBeenCalled();
  });

  it("keeps the connection when the write consent came from another account", async () => {
    const { service, repository, client } = setup();
    repository.claimAttempt.mockResolvedValue(
      attemptOf({ requestedAccess: "write" }),
    );
    client.exchangeCode.mockResolvedValue({ ok: true, value: writeGrant });
    repository.findConnection.mockResolvedValue(storedOf("someone-else"));

    await expect(service.complete("admin", callbackOf())).resolves.toBe(
      "account_mismatch",
    );
    expect(repository.saveConnection).not.toHaveBeenCalled();
  });

  it.each([
    ["the same account", storedOf("perm")],
    ["no stored connection", null],
  ])("saves a write consent for %s", async (label, stored) => {
    const { service, repository, client } = setup();
    repository.claimAttempt.mockResolvedValue(
      attemptOf({ requestedAccess: "write" }),
    );
    client.exchangeCode.mockResolvedValue({ ok: true, value: writeGrant });
    repository.findConnection.mockResolvedValue(stored);

    await expect(service.complete("admin", callbackOf())).resolves.toBe(
      "connected",
    );
  });

  it("saves the encrypted connection after a read sign-in", async () => {
    const { service, repository } = setup();

    await expect(service.complete("admin", callbackOf())).resolves.toBe(
      "connected",
    );

    const call = repository.saveConnection.mock.calls[0] as unknown as [
      {
        connectedAt: number;
        connectedByUserId: string;
        googleEmail: string | null;
        googlePermissionId: string;
        grantedScope: string;
        refreshTokenSecret: string;
      },
    ];
    const saved = call[0];
    expect(saved).toMatchObject({
      connectedAt: NOW,
      connectedByUserId: "admin",
      googleEmail: "a@b.c",
      googlePermissionId: "perm",
      grantedScope: GOOGLE_DRIVE_SCOPE,
    });
    expect(
      cipher.decrypt(`google-drive:refresh:${NOW}`, saved.refreshTokenSecret),
    ).toBe("refresh");
    expect(repository.findConnection).not.toHaveBeenCalled();
    expect(logger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "google_drive.connected" }),
    );
  });
});

describe("GoogleDriveConnectionService clock", () => {
  it("uses the system clock by default", async () => {
    vi.spyOn(Date, "now").mockReturnValue(42);
    const { repository, client } = setup();
    const service = new GoogleDriveConnectionService({
      repository: repository as unknown as GoogleDriveRepository,
      cipher,
      runtime: { application: { clientId: "client" }, client },
      missingSettings: [],
    });

    await service.start({ userId: "admin", baseUrl: BASE_URL });

    expect(repository.insertAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ createdAt: 42 }),
    );
  });
});
