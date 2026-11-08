import { describe, expect, it, vi } from "vitest";

import { GoogleDriveConnectionService } from "@/backend/service/google/GoogleDriveConnectionService";

import type { GoogleDriveRepository } from "@/backend/database/repositories/google/GoogleDriveRepository";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { GoogleDriveRuntime } from "@/backend/service/google/GoogleDriveConnectionService";
import type { GoogleDriveStatus } from "@/definition/GoogleDrive";

const FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const READ_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const ORIGIN = "https://pages.example.test";

async function readStatus(grantedScope: string): Promise<GoogleDriveStatus> {
  const repository = {
    findConnection: vi.fn().mockResolvedValue({
      connectedAt: 1,
      connectedByUserId: "admin",
      googleEmail: "drive@example.test",
      googlePermissionId: "permission",
      grantedScope,
      reauthorizationReason: null,
      refreshTokenSecret: "sealed",
    }),
    recordRefresh: vi.fn().mockResolvedValue(true),
    recordVerification: vi.fn().mockResolvedValue(undefined),
  } as unknown as GoogleDriveRepository;
  const client = {
    exchangeCode: vi.fn(),
    readAccount: vi.fn().mockResolvedValue({
      ok: true,
      value: { emailAddress: "drive@example.test", permissionId: "permission" },
    }),
    refresh: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        accessToken: "access",
        expiresAt: Date.now() + 3_600_000,
        refreshToken: null,
      },
    }),
  } as unknown as GoogleDriveRuntime["client"];
  const service = new GoogleDriveConnectionService({
    cipher: {
      decrypt: () => "refresh",
    } as unknown as InstanceSecretCipher,
    missingSettings: [],
    repository,
    runtime: { application: { clientId: "client" }, client },
  });

  return service.getStatus({ allowed: [ORIGIN], current: ORIGIN });
}

describe("Google Drive folder access of the status", () => {
  it("asks for a new sign-in when only drive.file was granted", async () => {
    const status = await readStatus(FILE_SCOPE);

    expect(status.state).toBe("connected");
    expect(status.needsFolderAccess).toBe(true);
  });

  it("accepts a connection that may read the folder tree", async () => {
    const status = await readStatus(`${FILE_SCOPE} ${READ_SCOPE}`);

    expect(status.state).toBe("connected");
    expect(status.needsFolderAccess).toBe(false);
  });
});
