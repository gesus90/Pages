import { describe, expect, it, vi } from "vitest";

import {
  STORAGE_GRANTED_OPERATIONS,
  StorageAccessService,
} from "./StorageAccessService";

import type { StorageAccessContext } from "./StorageAccessService";
import type { AccountAccess } from "@/definition/Authorization";
import type { StorageGrant } from "@/definition/StorageAccess";
import type { StorageEntry } from "@/definition/GoogleDriveFiles";

function accountOf(overrides: Partial<AccountAccess> = {}): AccountAccess {
  const account: AccountAccess = {
    userId: "user-1",
    role: null,
    isAdmin: false,
    mode: "role",
    firstName: "Ada",
    lastName: "Lovelace",
    isActive: true,
    departments: [],
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: false,
    ...overrides,
  };

  return account;
}

const ADMIN = { isAdmin: true, mode: "admin" } as const;

function grantOf(folderRef: string): StorageGrant {
  return {
    permissionId: "perm",
    folderRef,
    folderName: `Folder ${folderRef}`,
    targetKind: "group",
    targetId: "g1",
  };
}

function entryOf(
  ref: string,
  parentRef: string | null,
  overrides: Partial<StorageEntry> = {},
): StorageEntry {
  return {
    ref,
    name: `Name ${ref}`,
    isFolder: true,
    mimeType: "application/vnd.google-apps.folder",
    isGoogleDocument: false,
    isTrashed: false,
    isExplicitlyTrashed: false,
    modifiedAt: null,
    sizeBytes: null,
    parentRef,
    driveRef: null,
    version: null,
    webViewLink: null,
    exportFormats: [],
    ...overrides,
  };
}

interface Harness {
  readonly service: StorageAccessService;
  readonly repository: {
    grants: ReturnType<typeof vi.fn>;
    targets: ReturnType<typeof vi.fn>;
    setGrant: ReturnType<typeof vi.fn>;
    record: ReturnType<typeof vi.fn>;
    history: ReturnType<typeof vi.fn>;
  };
  readonly stat: ReturnType<typeof vi.fn>;
}

function harnessOf(
  options: {
    account?: AccountAccess | null;
    isConnected?: boolean;
    entries?: readonly StorageEntry[];
  } = {},
): Harness {
  const account = options.account === undefined ? accountOf() : options.account;
  const entries = options.entries ?? [];
  const repository = {
    grants: vi.fn(async () => [grantOf("g-folder")]),
    targets: vi.fn(async () => [{ kind: "group", id: "g1", name: "G" }]),
    setGrant: vi.fn(async () => undefined),
    record: vi.fn(async () => undefined),
    history: vi.fn(async () => []),
  };
  const stat = vi.fn(async (ref: string) => {
    const entry = entries.find((candidate) => candidate.ref === ref);

    return entry
      ? { ok: true, value: { entry } }
      : { ok: false, error: { code: "not_found" } };
  });
  const service = new StorageAccessService({
    repository,
    account: async () => account,
    connection: {
      access: vi.fn(async () =>
        options.isConnected === false
          ? { ok: false, problem: "access_revoked", state: "unavailable" }
          : { ok: true, permissionId: "perm" },
      ),
    },
    reader: { stat },
  } as unknown as ConstructorParameters<typeof StorageAccessService>[0]);

  return { service, repository, stat };
}

function contextOf(
  overrides: Partial<StorageAccessContext> = {},
): StorageAccessContext {
  return {
    account: accountOf(),
    permissionId: "perm",
    isAdministrator: false,
    grants: [grantOf("root-folder")],
    ...overrides,
  };
}

const TREE = [
  entryOf("root-folder", null),
  entryOf("child", "root-folder"),
  entryOf("file", "child", { isFolder: false }),
  entryOf("outside", null),
  entryOf("trashed", "root-folder", { isTrashed: true }),
];

describe("StorageAccessService.context", () => {
  it("denies an unknown, inactive or mismatching account", async () => {
    expect(
      await harnessOf({ account: null }).service.context("user-1"),
    ).toBeNull();
    expect(
      await harnessOf({
        account: accountOf({ isActive: false }),
      }).service.context("user-1"),
    ).toBeNull();
    expect(
      await harnessOf({ account: accountOf({ userId: "x" }) }).service.context(
        "user-1",
      ),
    ).toBeNull();
  });

  it("loads the grants of an ordinary user", async () => {
    const { service, repository } = harnessOf();
    const context = await service.context("user-1");

    expect(repository.grants).toHaveBeenCalledWith("user-1", "perm");
    expect(context?.isAdministrator).toBe(false);
    expect(context?.grants).toHaveLength(1);
  });

  it("loads all grants for an administrator", async () => {
    const { service, repository } = harnessOf({ account: accountOf(ADMIN) });
    const context = await service.context("user-1");

    expect(repository.grants).toHaveBeenCalledWith(null, "perm");
    expect(context?.isAdministrator).toBe(true);
  });

  it("denies an ordinary user without a usable connection", async () => {
    const { service } = harnessOf({ isConnected: false });

    expect(await service.context("user-1")).toBeNull();
  });

  it("lets an administrator in without a usable connection", async () => {
    const { service } = harnessOf({
      account: accountOf(ADMIN),
      isConnected: false,
    });
    const context = await service.context("user-1");

    expect(context?.permissionId).toBe("");
    expect(context?.grants).toEqual([]);
  });
});

describe("StorageAccessService.allows", () => {
  const { service } = harnessOf({ entries: TREE });

  it("allows an administrator everything", async () => {
    expect(
      await service.allows(contextOf({ isAdministrator: true }), "quota", {
        isTrash: true,
      }),
    ).toBe(true);
  });

  it("refuses operations outside the grant and the trash", async () => {
    const context = contextOf();

    expect(await service.allows(context, "quota", { ref: "child" })).toBe(
      false,
    );
    expect(
      await service.allows(context, "list", { ref: "child", isTrash: true }),
    ).toBe(false);
  });

  it("allows capabilities only with a grant", async () => {
    expect(await service.allows(contextOf(), "capabilities", {})).toBe(true);
    expect(
      await service.allows(contextOf({ grants: [] }), "capabilities", {}),
    ).toBe(false);
  });

  it("allows confirmation only for update and overwrite", async () => {
    const context = contextOf();

    expect(
      await service.allows(context, "confirm", {
        ref: "child",
        action: "delete",
      }),
    ).toBe(false);
    expect(
      await service.allows(context, "confirm", {
        ref: "child",
        action: "update",
      }),
    ).toBe(true);
    expect(
      await service.allows(context, "confirm", {
        ref: "child",
        action: "overwrite",
      }),
    ).toBe(true);
  });

  it("checks the target ref of each operation", async () => {
    const context = contextOf();

    expect(await service.allows(context, "list", { ref: "child" })).toBe(true);
    expect(await service.allows(context, "list", { ref: "outside" })).toBe(
      false,
    );
    expect(await service.allows(context, "list", {})).toBe(false);
    expect(
      await service.allows(context, "upload", { parentRef: "child" }),
    ).toBe(true);
    expect(
      await service.allows(context, "create_folder", { parentRef: "outside" }),
    ).toBe(false);
    expect(
      await service.allows(context, "search", { folderRef: "child" }),
    ).toBe(true);
    expect(await service.allows(context, "search", { folderRef: null })).toBe(
      false,
    );
  });

  it("lists the granted operations", () => {
    expect(STORAGE_GRANTED_OPERATIONS).toContain("upload");
  });
});

describe("StorageAccessService.contains", () => {
  it("is true for an administrator without looking", async () => {
    const { service, stat } = harnessOf();

    expect(
      await service.contains(contextOf({ isAdministrator: true }), "x"),
    ).toBe(true);
    expect(stat).not.toHaveBeenCalled();
  });

  it("walks up to a granted folder", async () => {
    const { service } = harnessOf({ entries: TREE });

    expect(await service.contains(contextOf(), "file")).toBe(true);
    expect(await service.contains(contextOf(), "root-folder")).toBe(true);
  });

  it("refuses unknown, trashed and ungranted entries", async () => {
    const { service } = harnessOf({ entries: TREE });

    expect(await service.contains(contextOf(), "missing")).toBe(false);
    expect(await service.contains(contextOf(), "trashed")).toBe(false);
    expect(await service.contains(contextOf(), "outside")).toBe(false);
  });

  it("stops at a cycle", async () => {
    const { service } = harnessOf({
      entries: [entryOf("a", "b"), entryOf("b", "a")],
    });

    expect(await service.contains(contextOf(), "a")).toBe(false);
  });

  it("stops at the depth bound", async () => {
    const entries: StorageEntry[] = [];

    for (let index = 0; index < 200; index += 1) {
      entries.push(entryOf(`e${index}`, `e${index + 1}`));
    }

    const { service, stat } = harnessOf({ entries });

    expect(await service.contains(contextOf(), "e0")).toBe(false);
    expect(stat).toHaveBeenCalledTimes(128);
  });
});

describe("StorageAccessService.record", () => {
  it("records under the full name", async () => {
    const { service, repository } = harnessOf();

    await service.record(contextOf(), "list", "ref");

    expect(repository.record).toHaveBeenCalledWith(
      {
        actorId: "user-1",
        actorName: "Ada Lovelace",
        operation: "list",
        ref: "ref",
      },
      "perm",
    );
  });

  it("falls back to the user id without a name", async () => {
    const { service, repository } = harnessOf();

    await service.record(
      contextOf({ account: accountOf({ firstName: "", lastName: "" }) }),
      "list",
      "ref",
    );

    expect(repository.record.mock.calls[0]?.[0].actorName).toBe("user-1");
  });
});

describe("StorageAccessService.settings", () => {
  it("shows grants and targets to an administrator", async () => {
    const { service } = harnessOf({ account: accountOf(ADMIN) });
    const result = await service.settings("user-1");

    expect(result.ok && result.value.grants).toHaveLength(1);
    expect(result.ok && result.value.targets).toHaveLength(1);
  });

  it("refuses ordinary users and unknown accounts", async () => {
    const forbidden = { ok: false, error: { code: "forbidden" } };

    expect(await harnessOf().service.settings("user-1")).toEqual(forbidden);
    expect(
      await harnessOf({ account: null }).service.settings("user-1"),
    ).toEqual(forbidden);
  });
});

describe("StorageAccessService.setGrant", () => {
  const input = {
    folderRef: "root-folder",
    targetKind: "group",
    targetId: "g1",
  } as const;

  it("refuses non-administrators", async () => {
    expect(await harnessOf().service.setGrant("user-1", input, true)).toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
  });

  it("refuses an unknown recipient", async () => {
    const { service } = harnessOf({
      account: accountOf(ADMIN),
      entries: TREE,
    });

    expect(
      await service.setGrant("user-1", { ...input, targetId: "zz" }, true),
    ).toEqual({ ok: false, error: { code: "invalid_request" } });
    expect(
      await service.setGrant("user-1", { ...input, targetKind: "role" }, true),
    ).toEqual({ ok: false, error: { code: "invalid_request" } });
  });

  it("passes a folder lookup failure through", async () => {
    const { service } = harnessOf({ account: accountOf(ADMIN) });
    const result = await service.setGrant("user-1", input, true);

    expect(result).toEqual({ ok: false, error: { code: "not_found" } });
  });

  it("refuses files and trashed folders", async () => {
    const { service } = harnessOf({
      account: accountOf(ADMIN),
      entries: TREE,
    });
    const refused = { ok: false, error: { code: "not_folder" } };

    expect(
      await service.setGrant("user-1", { ...input, folderRef: "file" }, true),
    ).toEqual(refused);
    expect(
      await service.setGrant(
        "user-1",
        { ...input, folderRef: "trashed" },
        true,
      ),
    ).toEqual(refused);
  });

  it("stores and records a grant or a revocation", async () => {
    const { service, repository } = harnessOf({
      account: accountOf(ADMIN),
      entries: TREE,
    });

    expect(await service.setGrant("user-1", input, true)).toEqual({
      ok: true,
      value: {},
    });
    await service.setGrant("user-1", input, false);

    expect(repository.setGrant).toHaveBeenCalledWith(
      { ...input, permissionId: "perm", folderName: "Name root-folder" },
      true,
    );
    expect(
      repository.record.mock.calls.map((call) => call[0].operation),
    ).toEqual(["grant", "revoke"]);
  });
});

describe("StorageAccessService.history", () => {
  it("refuses unknown accounts and users without grants", async () => {
    const forbidden = { ok: false, error: { code: "forbidden" } };

    expect(
      await harnessOf({ account: null }).service.history("user-1"),
    ).toEqual(forbidden);

    const { service, repository } = harnessOf();

    repository.grants.mockResolvedValue([]);

    expect(await service.history("user-1")).toEqual(forbidden);
  });

  it("limits ordinary users to their own activity", async () => {
    const { service, repository } = harnessOf();

    expect(await service.history("user-1")).toEqual({ ok: true, value: [] });
    expect(repository.history).toHaveBeenCalledWith("user-1", "perm");
  });

  it("shows an administrator all activity", async () => {
    const { service, repository } = harnessOf({ account: accountOf(ADMIN) });

    await service.history("user-1");

    expect(repository.history).toHaveBeenCalledWith(null, "perm");
  });
});
