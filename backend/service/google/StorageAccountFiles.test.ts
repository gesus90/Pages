import { describe, expect, it, vi } from "vitest";

import { accountStorageFiles } from "./StorageAccountFiles";

import type {
  StorageAccessContext,
  StorageAccessService,
} from "./StorageAccessService";
import type { StorageAccountFiles } from "./StorageAccountFiles";
import type { GoogleDriveFileService } from "./GoogleDriveFileService";
import type { StorageCapabilities } from "@/definition/GoogleDriveFiles";

const OK = { ok: true, value: "v" };

function contextOf(
  overrides: Partial<StorageAccessContext> = {},
): StorageAccessContext {
  return {
    account: {} as unknown as StorageAccessContext["account"],
    permissionId: "perm",
    isAdministrator: false,
    grants: [
      { folderRef: "f1", folderName: "F1" },
    ] as unknown as StorageAccessContext["grants"],
    ...overrides,
  };
}

interface AccessDouble {
  context: ReturnType<typeof vi.fn>;
  allows: ReturnType<typeof vi.fn>;
  contains: ReturnType<typeof vi.fn>;
  record: ReturnType<typeof vi.fn>;
}

function accessOf(
  context: StorageAccessContext | null,
  isAllowed = true,
  isContained = true,
): AccessDouble {
  return {
    context: vi.fn(async () => context),
    allows: vi.fn(async () => isAllowed),
    contains: vi.fn(async () => isContained),
    record: vi.fn(async () => undefined),
  };
}

const METHODS = [
  "list",
  "search",
  "stat",
  "resolvePath",
  "read",
  "download",
  "quota",
  "createFolder",
  "upload",
  "update",
  "copy",
  "move",
  "rename",
  "trash",
  "restore",
  "deletePermanently",
  "confirm",
] as const;

function filesOf(capabilities: StorageCapabilities | null = null): {
  files: GoogleDriveFileService;
  calls: Record<string, ReturnType<typeof vi.fn>>;
  batchRun: ReturnType<typeof vi.fn>;
} {
  const calls: Record<string, ReturnType<typeof vi.fn>> = {};

  for (const method of METHODS) {
    calls[method] = vi.fn(async () => OK);
  }

  const batchRun = vi.fn(async () => OK);
  const files = {
    isSimulation: true,
    reader: calls,
    writer: calls,
    batch: { run: batchRun },
    capabilities: vi.fn(async () =>
      capabilities
        ? { ok: true, value: capabilities }
        : { ok: false, error: { code: "connection_unavailable" } },
    ),
  } as unknown as GoogleDriveFileService;

  return { files, calls, batchRun };
}

function facadeOf(
  access: AccessDouble | null,
  files: GoogleDriveFileService,
): StorageAccountFiles {
  return accountStorageFiles(
    files,
    "user-1",
    access as unknown as StorageAccessService | null,
  );
}

const CAPABILITIES = {
  canRead: true,
  canRequestWriteAccess: true,
  canWrite: true,
  exportFormats: {},
  isSimulation: false,
  maxReadBytes: 1,
  maxUploadBytes: 1,
  operations: ["list", "quota", "upload", "delete"],
  pageSizeLimit: 1,
} as unknown as StorageCapabilities;

describe("accountStorageFiles run", () => {
  it("forbids calls without an access service or a context", async () => {
    const { files, calls } = filesOf();
    const forbidden = { ok: false, error: { code: "forbidden" } };

    expect(await facadeOf(null, files).reader.stat("x")).toEqual(forbidden);
    expect(await facadeOf(accessOf(null), files).reader.stat("x")).toEqual(
      forbidden,
    );
    expect(calls["stat"]).not.toHaveBeenCalled();
  });

  it("forbids calls the access service does not allow", async () => {
    const { files, calls } = filesOf();
    const access = accessOf(contextOf(), false);

    expect(await facadeOf(access, files).reader.stat("x")).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(calls["stat"]).not.toHaveBeenCalled();
    expect(access.record).not.toHaveBeenCalled();
  });

  it("records a successful call against the ref, parent ref or folder ref", async () => {
    const { files } = filesOf();
    const access = accessOf(contextOf());
    const facade = facadeOf(access, files);

    await facade.reader.stat("r");
    await facade.writer.upload({ parentRef: "p" } as unknown as never);
    await facade.reader.search({ folderRef: "s" } as unknown as never);
    await facade.reader.quota();

    expect(
      access.record.mock.calls.map((call: unknown[]) => [call[1], call[2]]),
    ).toEqual([
      ["stat", "r"],
      ["upload", "p"],
      ["search", "s"],
      ["quota", ""],
    ]);
  });

  it("does not record a failed call", async () => {
    const { files, calls } = filesOf();
    const access = accessOf(contextOf());

    calls["stat"]?.mockResolvedValue({ ok: false, error: { code: "x" } });
    await facadeOf(access, files).reader.stat("r");

    expect(access.record).not.toHaveBeenCalled();
  });
});

describe("accountStorageFiles operations", () => {
  it("routes reader and writer calls with the bound user", async () => {
    const { files, calls, batchRun } = filesOf();
    const access = accessOf(contextOf());
    const facade = facadeOf(access, files);
    const input = { ref: "r", userId: "attacker" } as unknown as never;

    await facade.reader.list(input);
    await facade.reader.read("r", "pdf");
    await facade.reader.download("r", "pdf");
    await facade.writer.createFolder(input);
    await facade.writer.update(input);
    await facade.writer.confirm(input);
    await facade.writer.copy(input);
    await facade.writer.move(input);
    await facade.writer.rename(input);
    await facade.writer.trash(input);
    await facade.writer.restore(input);
    await facade.writer.deletePermanently(input);
    await facade.batch.run({ ref: "r" } as unknown as never);

    expect(calls["read"]).toHaveBeenCalledWith("r", "pdf");
    expect(calls["download"]).toHaveBeenCalledWith("r", "pdf");
    expect(calls["list"]).toHaveBeenCalledWith(input);
    expect(calls["trash"]).toHaveBeenCalledWith({ ref: "r", userId: "user-1" });
    expect(batchRun).toHaveBeenCalledWith({ ref: "r", userId: "user-1" });
    expect(access.allows.mock.calls.map((call: unknown[]) => call[1])).toEqual([
      "list",
      "read",
      "download",
      "create_folder",
      "update",
      "confirm",
      "copy",
      "move",
      "rename",
      "delete",
      "restore",
      "delete_permanently",
      "batch",
    ]);
    expect(facade.isSimulation).toBe(true);
  });
});

describe("accountStorageFiles resolvePath", () => {
  const found = {
    ok: true,
    value: { entry: { ref: "e" } },
  };

  it("forbids without access service or context", async () => {
    const { files } = filesOf();
    const forbidden = { ok: false, error: { code: "forbidden" } };

    expect(await facadeOf(null, files).reader.resolvePath("/a")).toEqual(
      forbidden,
    );
    expect(
      await facadeOf(accessOf(null), files).reader.resolvePath("/a"),
    ).toEqual(forbidden);
  });

  it("checks the resolved entry for an ordinary user", async () => {
    const { files, calls } = filesOf();
    const access = accessOf(contextOf());

    calls["resolvePath"]?.mockResolvedValue(found);

    expect(await facadeOf(access, files).reader.resolvePath("/a")).toBe(found);
    expect(access.allows).toHaveBeenCalledWith(
      expect.anything(),
      "resolve_path",
      { ref: "e" },
    );
    expect(access.record).toHaveBeenCalledWith(
      expect.anything(),
      "resolve_path",
      "e",
    );
  });

  it("hides a failure from an ordinary user but not from an administrator", async () => {
    const { files, calls } = filesOf();
    const failure = { ok: false, error: { code: "not_found" } };

    calls["resolvePath"]?.mockResolvedValue(failure);

    expect(
      await facadeOf(accessOf(contextOf()), files).reader.resolvePath("/a"),
    ).toEqual({ ok: false, error: { code: "forbidden" } });
    expect(
      await facadeOf(
        accessOf(contextOf({ isAdministrator: true })),
        files,
      ).reader.resolvePath("/a"),
    ).toBe(failure);
  });
});

describe("accountStorageFiles capabilities", () => {
  it("forbids without a context or without grants", async () => {
    const { files } = filesOf(CAPABILITIES);
    const forbidden = { ok: false, error: { code: "forbidden" } };

    expect(await facadeOf(null, files).capabilities()).toEqual(forbidden);
    expect(await facadeOf(accessOf(null), files).capabilities()).toEqual(
      forbidden,
    );
    expect(
      await facadeOf(accessOf(contextOf({ grants: [] })), files).capabilities(),
    ).toEqual(forbidden);
  });

  it("forbids a folder outside the grants", async () => {
    const { files } = filesOf(CAPABILITIES);
    const access = accessOf(contextOf(), true, false);

    expect(await facadeOf(access, files).capabilities("outside")).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
  });

  it("passes a failure of the Drive check through", async () => {
    const { files } = filesOf(null);
    const result = await facadeOf(accessOf(contextOf()), files).capabilities();

    expect(result.ok).toBe(false);
  });

  it("narrows the operations for an ordinary user", async () => {
    const { files } = filesOf(CAPABILITIES);
    const access = accessOf(contextOf());
    const result = await facadeOf(access, files).capabilities("f1");

    expect(result.ok && result.value.operations).toEqual(["list", "upload"]);
    expect(result.ok && result.value.canRequestWriteAccess).toBe(false);
    expect(result.ok && result.value.grantedFolders).toEqual([
      { ref: "f1", name: "F1" },
    ]);
    expect(access.record).toHaveBeenCalledWith(
      expect.anything(),
      "capabilities",
      "f1",
    );
  });

  it("shows an administrator everything and records an empty folder", async () => {
    const { files } = filesOf(CAPABILITIES);
    const access = accessOf(contextOf({ isAdministrator: true, grants: [] }));
    const result = await facadeOf(access, files).capabilities();

    expect(result.ok && result.value.operations).toEqual(
      CAPABILITIES.operations,
    );
    expect(result.ok && result.value.canRequestWriteAccess).toBe(true);
    expect(result.ok && result.value.grantedFolders).toBeUndefined();
    expect(access.contains).not.toHaveBeenCalled();
    expect(access.record).toHaveBeenCalledWith(
      expect.anything(),
      "capabilities",
      "",
    );
  });
});
