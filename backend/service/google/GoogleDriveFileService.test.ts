import { describe, expect, it, vi } from "vitest";

import { GoogleDriveFileService } from "./GoogleDriveFileService";

import type { StorageAccessService } from "./StorageAccessService";
import type {
  StorageConnection,
  StorageDriveClient,
} from "./StorageFileSupport";

function connectionOf(scopes: readonly string[] | null): StorageConnection {
  const connection = {
    access: vi.fn(async () =>
      scopes === null
        ? {
            ok: false as const,
            problem: "access_revoked" as const,
            state: "unavailable" as const,
          }
        : {
            ok: true as const,
            accessToken: "t",
            accountEmail: "a@example.test",
            grantedScopes: scopes,
            permissionId: "p",
          },
    ),
  };

  return connection;
}

function serviceOf(
  scopes: readonly string[] | null,
  options: {
    canRequestWriteAccess?: boolean;
    access?: StorageAccessService;
  } = {},
): GoogleDriveFileService {
  return new GoogleDriveFileService({
    connection: connectionOf(scopes),
    drive: {} as unknown as StorageDriveClient,
    isSimulation: true,
    canRequestWriteAccess: options.canRequestWriteAccess ?? true,
    ...(options.access ? { access: options.access } : {}),
  });
}

const WRITE_SCOPE = "https://www.googleapis.com/auth/drive";

describe("GoogleDriveFileService", () => {
  it("exposes its parts", () => {
    const service = serviceOf([]);

    expect(service.isSimulation).toBe(true);
    expect(service.reader).toBeDefined();
    expect(service.writer).toBeDefined();
    expect(service.batch).toBeDefined();
  });

  it("names read-only capabilities and the option to request writing", async () => {
    const result = await serviceOf([]).capabilities();

    expect(result.ok && result.value.canWrite).toBe(false);
    expect(result.ok && result.value.canRequestWriteAccess).toBe(true);
    expect(result.ok && result.value.operations).not.toContain("upload");
  });

  it("offers no consent when no OAuth client exists", async () => {
    const result = await serviceOf([], {
      canRequestWriteAccess: false,
    }).capabilities();

    expect(result.ok && result.value.canRequestWriteAccess).toBe(false);
  });

  it("names write capabilities with a write scope", async () => {
    const result = await serviceOf([WRITE_SCOPE]).capabilities();

    expect(result.ok && result.value.canWrite).toBe(true);
    expect(result.ok && result.value.canRequestWriteAccess).toBe(false);
    expect(result.ok && result.value.operations).toContain("upload");
  });

  it("fails when the connection is unusable", async () => {
    const result = await serviceOf(null).capabilities();

    expect(result.ok).toBe(false);
  });

  it("denies the account facade without an access service", async () => {
    const files = serviceOf([]).forAccount("user-1");

    expect(files.isSimulation).toBe(true);
    expect(await files.reader.stat("x")).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
  });

  it("binds the account facade to the access service", async () => {
    const access = {
      context: vi.fn(async () => null),
    } as unknown as StorageAccessService;
    const files = serviceOf([], { access }).forAccount("user-1");

    await files.reader.stat("x");

    expect(access.context).toHaveBeenCalledWith("user-1");
  });
});
