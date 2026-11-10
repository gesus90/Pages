import { vi } from "vitest";

import { StorageConfirmations } from "@/backend/service/google/StorageConfirmations";
import { StorageFileWriter } from "@/backend/service/google/StorageFileWriter";

import type { DriveItemResult } from "@/backend/google/GoogleDriveItemsClient";
import type {
  StorageConnection,
  StorageDriveClient,
} from "@/backend/service/google/StorageFileSupport";
import type { GoogleDriveAccess } from "@/backend/service/google/GoogleDriveConnectionService";
import type { GoogleDriveProblem } from "@/definition/GoogleDrive";
import type {
  StorageEntry,
  StorageEntryPage,
  StorageErrorCode,
  StorageResult,
} from "@/definition/GoogleDriveFiles";

export const FULL_SCOPE = "https://www.googleapis.com/auth/drive";
export const READ_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const TOKEN = "access-token";
export const USER = "user-1";

/** Builds a Drive entry; a folder gets the Drive folder type. */
export function makeEntry(
  ref: string,
  overrides: Partial<StorageEntry> = {},
): StorageEntry {
  const isFolder = overrides.isFolder ?? false;

  return {
    driveRef: null,
    exportFormats: [],
    isExplicitlyTrashed: false,
    isFolder,
    isGoogleDocument: false,
    isTrashed: false,
    mimeType: isFolder ? "application/vnd.google-apps.folder" : "text/plain",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    name: ref,
    parentRef: "root",
    ref,
    sizeBytes: isFolder ? null : 10,
    version: "1",
    webViewLink: null,
    ...overrides,
  };
}

/** A refused Drive request. */
export function refusal(
  code: StorageErrorCode,
  connectionProblem: GoogleDriveProblem | null = null,
): DriveItemResult<never> {
  return { code, connectionProblem, ok: false };
}

function ok<Value>(value: Value): DriveItemResult<Value> {
  return { ok: true, value };
}

/** The scripted Drive: entries by reference, children by folder, and call recorders. */
export interface FakeDrive {
  readonly client: StorageDriveClient;
  readonly entries: Map<string, StorageEntry>;
  readonly children: Map<string, StorageEntry[]>;
  readonly calls: {
    readonly stat: ReturnType<typeof vi.fn>;
    readonly query: ReturnType<typeof vi.fn>;
    readonly createFolder: ReturnType<typeof vi.fn>;
    readonly upload: ReturnType<typeof vi.fn>;
    readonly replaceContent: ReturnType<typeof vi.fn>;
    readonly change: ReturnType<typeof vi.fn>;
    readonly copy: ReturnType<typeof vi.fn>;
    readonly remove: ReturnType<typeof vi.fn>;
  };
}

function matchChildren(
  children: readonly StorageEntry[],
  query: string,
): StorageEntry[] {
  const exact = /name = '([^']*)'/.exec(query);
  const partial = /name contains '([^']*)'/.exec(query);

  if (exact) return children.filter((child) => child.name === exact[1]);
  if (partial) {
    return children.filter((child) => child.name.includes(partial[1] ?? ""));
  }

  return query.includes("trashed = false")
    ? children.filter((child) => !child.isTrashed)
    : [...children];
}

function queryPage(
  children: Map<string, StorageEntry[]>,
  query: string,
): StorageEntryPage {
  const parent = /^'([^']*)' in parents/.exec(query)?.[1] ?? "";

  return {
    entries: matchChildren(children.get(parent) ?? [], query),
    nextPageToken: null,
  };
}

/** Builds a Drive whose answers come from `entries` and `children`. */
export function createFakeDrive(initial: readonly StorageEntry[]): FakeDrive {
  const entries = new Map(initial.map((entry) => [entry.ref, entry]));
  const children = new Map<string, StorageEntry[]>();
  let counter = 0;

  for (const entry of initial) {
    const siblings = children.get(entry.parentRef ?? "") ?? [];

    children.set(entry.parentRef ?? "", [...siblings, entry]);
  }

  const place = (
    name: string,
    parentId: string,
    isFolder: boolean,
  ): StorageEntry => {
    counter += 1;

    return makeEntry(`new-${counter}`, { isFolder, name, parentRef: parentId });
  };
  const calls = {
    change: vi.fn(
      async (
        accessToken: string,
        ref: string,
        change: {
          readonly name?: string;
          readonly isTrashed?: boolean;
          readonly addParentId?: string;
        },
      ): Promise<DriveItemResult<StorageEntry>> => {
        const current = entries.get(ref) ?? makeEntry(ref);
        const next: StorageEntry = {
          ...current,
          isExplicitlyTrashed: change.isTrashed ?? current.isExplicitlyTrashed,
          isTrashed: change.isTrashed ?? current.isTrashed,
          name: change.name ?? current.name,
          parentRef: change.addParentId ?? current.parentRef,
        };

        return ok(next);
      },
    ),
    copy: vi.fn(
      async (
        accessToken: string,
        sourceRef: string,
        target: { readonly name: string; readonly parentId: string },
      ): Promise<DriveItemResult<StorageEntry>> =>
        ok(place(target.name, target.parentId, false)),
    ),
    createFolder: vi.fn(
      async (
        accessToken: string,
        input: { readonly name: string; readonly parentId: string },
      ): Promise<DriveItemResult<StorageEntry>> =>
        ok(place(input.name, input.parentId, true)),
    ),
    query: vi.fn(
      async (
        accessToken: string,
        request: { readonly query: string },
      ): Promise<DriveItemResult<StorageEntryPage>> =>
        ok(queryPage(children, request.query)),
    ),
    remove: vi.fn(async (): Promise<DriveItemResult<null>> => ok(null)),
    replaceContent: vi.fn(
      async (
        accessToken: string,
        ref: string,
      ): Promise<DriveItemResult<StorageEntry>> =>
        ok({ ...(entries.get(ref) ?? makeEntry(ref)), version: "2" }),
    ),
    stat: vi.fn(
      async (
        accessToken: string,
        ref: string,
      ): Promise<DriveItemResult<StorageEntry>> => {
        const entry = entries.get(ref);

        return entry ? ok(entry) : refusal("not_found");
      },
    ),
    upload: vi.fn(
      async (
        accessToken: string,
        upload: { readonly name: string; readonly parentId: string },
      ): Promise<DriveItemResult<StorageEntry>> =>
        ok(place(upload.name, upload.parentId, false)),
    ),
  };

  return {
    calls,
    children,
    client: {
      ...calls,
      download: vi.fn(),
      export: vi.fn(),
      listSharedDrives: vi.fn(),
      readQuota: vi.fn(),
    },
    entries,
  };
}

/** A connection that grants the given scopes, or is unusable. */
export function createConnection(
  access: GoogleDriveAccess = {
    accountEmail: null,
    accessToken: TOKEN,
    grantedScopes: [FULL_SCOPE],
    ok: true,
    permissionId: "permission",
  },
): StorageConnection {
  return { access: vi.fn(async () => access) };
}

/** A writer over a fake Drive that holds a root folder. */
export function createWriter(
  extra: readonly StorageEntry[] = [],
  connection: StorageConnection = createConnection(),
): { readonly writer: StorageFileWriter; readonly drive: FakeDrive } {
  const drive = createFakeDrive([
    makeEntry("root", { isFolder: true, name: "My Drive", parentRef: null }),
    ...extra,
  ]);

  return {
    drive,
    writer: new StorageFileWriter(
      connection,
      drive.client,
      new StorageConfirmations(),
    ),
  };
}

/** Reads the value of a successful result. */
export function valueOf<Value>(result: StorageResult<Value>): Value {
  if (!result.ok) {
    throw new Error(`expected success, got ${result.error.code}`);
  }

  return result.value;
}

/** Reads the error code of a failed result. */
export function codeOf<Value>(result: StorageResult<Value>): string {
  return result.ok ? "ok" : result.error.code;
}
