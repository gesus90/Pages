import { constants } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CredentialStoreError } from "../../src/credential-error.ts";
import {
  CredentialStore,
  credentialDirectory,
  isStoredCredential,
} from "../../src/credential-store.ts";

import type { Mock } from "vitest";
import type { StoredCredential } from "../../src/credential-store.ts";

interface FakeStats {
  readonly mode: number;
  readonly uid: number;
  readonly isSymbolicLink: () => boolean;
  readonly isDirectory: () => boolean;
  readonly isFile: () => boolean;
}

interface FakeHandle {
  readonly close: Mock<() => Promise<void>>;
  readonly sync: Mock<() => Promise<void>>;
  readonly writeFile: Mock<(contents: string) => Promise<void>>;
}

interface FakeEntry {
  readonly kind: "directory" | "file" | "symlink";
  readonly permissions: number;
  readonly uid: number;
}

const mocks = vi.hoisted(() => ({
  lstat: vi.fn<(target: string) => Promise<FakeStats>>(),
  mkdir:
    vi.fn<
      (
        target: string,
        options: { recursive: boolean; mode: number },
      ) => Promise<undefined>
    >(),
  open: vi.fn<
    (target: string, flags: number, mode: number) => Promise<FakeHandle>
  >(),
  readFile: vi.fn<(target: string, encoding: string) => Promise<string>>(),
  rename: vi.fn<(source: string, destination: string) => Promise<void>>(),
  unlink: vi.fn<(target: string) => Promise<void>>(),
  delay: vi.fn<(milliseconds: number) => Promise<void>>(),
  randomUUID: vi.fn<() => string>(),
  homedir: vi.fn<() => string>(),
}));

vi.mock("node:fs/promises", () => ({
  lstat: mocks.lstat,
  mkdir: mocks.mkdir,
  open: mocks.open,
  readFile: mocks.readFile,
  rename: mocks.rename,
  unlink: mocks.unlink,
}));
vi.mock("node:timers/promises", () => ({ setTimeout: mocks.delay }));
vi.mock("node:crypto", () => ({ randomUUID: mocks.randomUUID }));
vi.mock("node:os", () => ({ homedir: mocks.homedir }));

const USER_ID = 1000;
const HOME = "/synthetic/home";
const DIRECTORY = "/synthetic/config/pages-mcp";
const FILENAME = `${DIRECTORY}/credentials.json`;
const LOCK_PATH = `${DIRECTORY}/credentials.lock`;
const UUID = "00000000-0000-4000-8000-000000000000";
const TEMPORARY_PATH = `${DIRECTORY}/credentials-${UUID}.tmp`;
const EXCLUSIVE_WRITE =
  constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY;
const ENVIRONMENT = {
  XDG_CONFIG_HOME: "/synthetic/config",
  APPDATA: "/synthetic/config",
};
const DEFAULT_MESSAGE =
  "Could not use credentials.json. Check its directory (0700) and file (0600) permissions.";
const LOCKED_MESSAGE =
  "credentials.json is locked. Finish the other pairing or rotation; remove credentials.lock only if no Pages MCP process is running.";
const INSTANCE = new URL("https://pages.example/");
const OTHER_INSTANCE = "https://other.example/";
const CREDENTIAL: StoredCredential = {
  tokenId: "token-1",
  token: "a".repeat(43),
  name: "Synthetic client",
  expiresAt: null,
  pairedAt: 1_700_000_000_000,
};
const OTHER_CREDENTIAL: StoredCredential = {
  tokenId: "token-2",
  token: "b".repeat(43),
  name: "Other client",
  expiresAt: 1_800_000_000_000,
  pairedAt: 1_700_000_000_001,
};
const TYPE_BITS = { directory: 0o40000, file: 0o100000, symlink: 0o120000 };

const entries = new Map<string, FakeEntry>();
const files = new Map<string, string>();
const handles = new Map<string, FakeHandle>();
const writeFailures = new Map<string, Error>();
const ORIGINAL_DESCRIPTORS = new Map<string, PropertyDescriptor | undefined>();

function codedError(code: string): Error {
  return Object.assign(new Error(`synthetic ${code}`), { code });
}

function statsOf(entry: FakeEntry): FakeStats {
  return {
    mode: TYPE_BITS[entry.kind] | entry.permissions,
    uid: entry.uid,
    isSymbolicLink: () => entry.kind === "symlink",
    isDirectory: () => entry.kind === "directory",
    isFile: () => entry.kind === "file",
  };
}

function createHandle(target: string): FakeHandle {
  const failure = writeFailures.get(target);
  const handle: FakeHandle = {
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    sync: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    writeFile: failure
      ? vi.fn<(contents: string) => Promise<void>>().mockRejectedValue(failure)
      : vi
          .fn<(contents: string) => Promise<void>>()
          .mockResolvedValue(undefined),
  };
  handles.set(target, handle);
  return handle;
}

function overrideProcess(
  property: "platform" | "getuid",
  replacement: unknown,
): void {
  if (!ORIGINAL_DESCRIPTORS.has(property))
    ORIGINAL_DESCRIPTORS.set(
      property,
      Object.getOwnPropertyDescriptor(process, property),
    );
  Object.defineProperty(process, property, {
    value: replacement,
    configurable: true,
    writable: true,
  });
}

function restoreProcess(): void {
  for (const [property, descriptor] of ORIGINAL_DESCRIPTORS) {
    if (descriptor) Object.defineProperty(process, property, descriptor);
    else Reflect.deleteProperty(process, property);
  }
  ORIGINAL_DESCRIPTORS.clear();
}

function storeFile(contents: string, entry: Partial<FakeEntry> = {}): void {
  entries.set(FILENAME, {
    kind: "file",
    permissions: 0o600,
    uid: USER_ID,
    ...entry,
  });
  files.set(FILENAME, contents);
}

function storeCredentials(credentials: Record<string, StoredCredential>): void {
  storeFile(JSON.stringify(credentials));
}

function writtenCredentials(): unknown {
  const contents = handles.get(TEMPORARY_PATH)?.writeFile.mock.calls[0]?.[0];
  return JSON.parse(contents ?? "null");
}

beforeEach(() => {
  vi.resetAllMocks();
  entries.clear();
  files.clear();
  handles.clear();
  writeFailures.clear();
  overrideProcess("platform", "linux");
  overrideProcess("getuid", () => USER_ID);
  entries.set(DIRECTORY, {
    kind: "directory",
    permissions: 0o700,
    uid: USER_ID,
  });
  mocks.lstat.mockImplementation(async (target) => {
    const entry = entries.get(target);
    if (!entry) throw codedError("ENOENT");
    return statsOf(entry);
  });
  mocks.readFile.mockImplementation(async (target) => {
    const contents = files.get(target);
    if (contents === undefined) throw codedError("ENOENT");
    return contents;
  });
  mocks.open.mockImplementation(async (target) => createHandle(target));
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.rename.mockResolvedValue(undefined);
  mocks.unlink.mockResolvedValue(undefined);
  mocks.delay.mockResolvedValue(undefined);
  mocks.randomUUID.mockReturnValue(UUID);
  mocks.homedir.mockReturnValue(HOME);
});

afterEach(() => {
  restoreProcess();
});

describe("CredentialStoreError", () => {
  it("uses a fixed permission diagnostic by default", () => {
    const error = new CredentialStoreError();
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(DEFAULT_MESSAGE);
  });

  it("keeps an explicit message", () => {
    expect(new CredentialStoreError("Custom.").message).toBe("Custom.");
  });
});

describe("isStoredCredential", () => {
  it.each([
    ["a credential without expiry", CREDENTIAL],
    ["a credential with expiry", OTHER_CREDENTIAL],
    ["a name of 100 characters", { ...CREDENTIAL, name: "n".repeat(100) }],
    ["a padded token", { ...CREDENTIAL, token: "abc.DEF_~+/-==" }],
  ])("accepts %s", (_, input) => {
    expect(isStoredCredential(input)).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "credential"],
    ["a missing tokenId", { ...CREDENTIAL, tokenId: undefined }],
    ["a numeric tokenId", { ...CREDENTIAL, tokenId: 1 }],
    ["an empty tokenId", { ...CREDENTIAL, tokenId: "" }],
    ["a missing token", { ...CREDENTIAL, token: undefined }],
    ["a numeric token", { ...CREDENTIAL, token: 1 }],
    ["a token with whitespace", { ...CREDENTIAL, token: "a b" }],
    ["a missing name", { ...CREDENTIAL, name: undefined }],
    ["a numeric name", { ...CREDENTIAL, name: 1 }],
    ["an empty name", { ...CREDENTIAL, name: "" }],
    ["a name of 101 characters", { ...CREDENTIAL, name: "n".repeat(101) }],
    ["a missing expiresAt", { ...CREDENTIAL, expiresAt: undefined }],
    ["a textual expiresAt", { ...CREDENTIAL, expiresAt: "soon" }],
    ["a fractional expiresAt", { ...CREDENTIAL, expiresAt: 1.5 }],
    ["a missing pairedAt", { ...CREDENTIAL, pairedAt: undefined }],
    ["a textual pairedAt", { ...CREDENTIAL, pairedAt: "now" }],
    ["an unsafe pairedAt", { ...CREDENTIAL, pairedAt: 2 ** 53 }],
  ])("rejects %s", (_, input) => {
    const candidate: unknown =
      typeof input === "object" && input !== null
        ? JSON.parse(JSON.stringify(input))
        : input;
    expect(isStoredCredential(candidate)).toBe(false);
  });
});

describe("credentialDirectory", () => {
  it("uses APPDATA on Windows", () => {
    expect(
      credentialDirectory({ APPDATA: "/synthetic/appdata" }, "win32"),
    ).toBe("/synthetic/appdata/pages-mcp");
  });

  it.each([
    ["missing", {}],
    ["empty", { APPDATA: "" }],
    ["relative", { APPDATA: "relative/appdata" }],
  ])("rejects a %s APPDATA on Windows", (_, environment) => {
    expect(() => credentialDirectory(environment, "win32")).toThrow(
      CredentialStoreError,
    );
  });

  it("uses Application Support on macOS", () => {
    expect(credentialDirectory(ENVIRONMENT, "darwin")).toBe(
      `${HOME}/Library/Application Support/pages-mcp`,
    );
  });

  it("uses XDG_CONFIG_HOME on other platforms", () => {
    expect(credentialDirectory(ENVIRONMENT, "linux")).toBe(DIRECTORY);
  });

  it("falls back to ~/.config without XDG_CONFIG_HOME", () => {
    expect(credentialDirectory({}, "linux")).toBe(`${HOME}/.config/pages-mcp`);
  });

  it("rejects a relative XDG_CONFIG_HOME", () => {
    expect(() =>
      credentialDirectory({ XDG_CONFIG_HOME: "relative" }, "linux"),
    ).toThrow(CredentialStoreError);
  });

  it("defaults to the current platform", () => {
    overrideProcess("platform", "win32");
    expect(credentialDirectory({ APPDATA: "/synthetic/appdata" })).toBe(
      "/synthetic/appdata/pages-mcp",
    );
  });
});

describe("CredentialStore.get file checks", () => {
  it("returns the credential of the exact instance", async () => {
    storeCredentials({
      [INSTANCE.href]: CREDENTIAL,
      [OTHER_INSTANCE]: OTHER_CREDENTIAL,
    });
    const store = new CredentialStore(ENVIRONMENT);
    await expect(store.get(INSTANCE)).resolves.toEqual(CREDENTIAL);
    expect(mocks.readFile).toHaveBeenCalledWith(FILENAME, "utf8");
    expect(mocks.lstat).toHaveBeenCalledWith(DIRECTORY);
    expect(mocks.lstat).toHaveBeenCalledWith(FILENAME);
  });

  it("returns null for an instance without an entry", async () => {
    storeCredentials({ [OTHER_INSTANCE]: OTHER_CREDENTIAL });
    await expect(new CredentialStore(ENVIRONMENT).get(INSTANCE)).resolves.toBe(
      null,
    );
  });

  it("treats a missing directory as an empty store", async () => {
    entries.clear();
    await expect(new CredentialStore(ENVIRONMENT).get(INSTANCE)).resolves.toBe(
      null,
    );
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("treats a missing file as an empty store", async () => {
    await expect(new CredentialStore(ENVIRONMENT).get(INSTANCE)).resolves.toBe(
      null,
    );
  });

  it.each([
    ["a symbolic link as directory", DIRECTORY, { kind: "symlink" }],
    ["a file as directory", DIRECTORY, { kind: "file" }],
    ["a broad directory mode", DIRECTORY, { permissions: 0o755 }],
    ["a foreign directory owner", DIRECTORY, { uid: USER_ID + 1 }],
    ["a symbolic link as file", FILENAME, { kind: "symlink" }],
    ["a directory as file", FILENAME, { kind: "directory" }],
    ["a broad file mode", FILENAME, { permissions: 0o644 }],
    ["a foreign file owner", FILENAME, { uid: USER_ID + 1 }],
  ] as const)("refuses %s", async (_, target, change) => {
    storeCredentials({ [INSTANCE.href]: CREDENTIAL });
    const current = entries.get(target);
    if (current) entries.set(target, { ...current, ...change });
    await expect(
      new CredentialStore(ENVIRONMENT).get(INSTANCE),
    ).rejects.toThrow(new CredentialStoreError(DEFAULT_MESSAGE));
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("refuses files when the user id is unavailable", async () => {
    storeCredentials({ [INSTANCE.href]: CREDENTIAL });
    overrideProcess("getuid", undefined);
    await expect(
      new CredentialStore(ENVIRONMENT).get(INSTANCE),
    ).rejects.toBeInstanceOf(CredentialStoreError);
  });

  it("skips mode and owner checks on Windows", async () => {
    storeFile(JSON.stringify({ [INSTANCE.href]: CREDENTIAL }), {
      permissions: 0o666,
      uid: USER_ID + 1,
    });
    entries.set(DIRECTORY, { kind: "directory", permissions: 0o777, uid: 0 });
    overrideProcess("platform", "win32");
    await expect(
      new CredentialStore(ENVIRONMENT).get(INSTANCE),
    ).resolves.toEqual(CREDENTIAL);
  });

  it("still refuses symbolic links on Windows", async () => {
    storeFile("{}", { kind: "symlink" });
    overrideProcess("platform", "win32");
    await expect(
      new CredentialStore(ENVIRONMENT).get(INSTANCE),
    ).rejects.toBeInstanceOf(CredentialStoreError);
  });

  it.each([
    ["a string", "synthetic failure"],
    ["null", null],
    ["an error without code", new Error("synthetic failure")],
    ["a permission error", codedError("EACCES")],
  ])("translates %s from the file system", async (_, failure) => {
    mocks.lstat.mockRejectedValue(failure);
    await expect(
      new CredentialStore(ENVIRONMENT).get(INSTANCE),
    ).rejects.toThrow(new CredentialStoreError(DEFAULT_MESSAGE));
  });
});

describe("CredentialStore.get content checks", () => {
  it.each([
    ["invalid JSON", "{"],
    ["a JSON array", "[]"],
    ["JSON null", "null"],
    ["a JSON number", "5"],
    ["an invalid entry", JSON.stringify({ [INSTANCE.href]: { token: "x" } })],
    [
      "a non-normalized instance key",
      JSON.stringify({ "https://pages.example/base/": CREDENTIAL }),
    ],
    [
      "an uppercase instance key",
      JSON.stringify({ "HTTPS://pages.example/": CREDENTIAL }),
    ],
    [
      "an invalid instance key",
      JSON.stringify({ "not an instance": CREDENTIAL }),
    ],
    [
      "a plain HTTP public instance key",
      JSON.stringify({ "http://pages.example/": CREDENTIAL }),
    ],
  ])("refuses %s", async (_, contents) => {
    storeFile(contents);
    await expect(
      new CredentialStore(ENVIRONMENT).get(INSTANCE),
    ).rejects.toThrow(new CredentialStoreError(DEFAULT_MESSAGE));
  });

  it("accepts an empty object", async () => {
    storeFile("{}");
    await expect(new CredentialStore(ENVIRONMENT).get(INSTANCE)).resolves.toBe(
      null,
    );
  });

  it("accepts a normalized instance key with a path", async () => {
    const instance = new URL("https://pages.example/base");
    storeCredentials({ [instance.href]: CREDENTIAL });
    await expect(
      new CredentialStore(ENVIRONMENT).get(instance),
    ).resolves.toEqual(CREDENTIAL);
  });
});

describe("CredentialStore.update", () => {
  it("creates a private directory and writes the first credential atomically", async () => {
    const operation = vi.fn(async (current: StoredCredential | null) => ({
      credential: CREDENTIAL,
      result: current,
    }));
    const store = new CredentialStore(ENVIRONMENT);
    await expect(store.update(INSTANCE, operation)).resolves.toBe(null);
    expect(mocks.mkdir).toHaveBeenCalledWith(DIRECTORY, {
      recursive: true,
      mode: 0o700,
    });
    expect(mocks.open).toHaveBeenNthCalledWith(
      1,
      LOCK_PATH,
      EXCLUSIVE_WRITE,
      0o600,
    );
    expect(mocks.open).toHaveBeenNthCalledWith(
      2,
      TEMPORARY_PATH,
      EXCLUSIVE_WRITE,
      0o600,
    );
    expect(writtenCredentials()).toEqual({ [INSTANCE.href]: CREDENTIAL });
    expect(handles.get(TEMPORARY_PATH)?.sync).toHaveBeenCalledOnce();
    expect(handles.get(TEMPORARY_PATH)?.close).toHaveBeenCalledOnce();
    expect(mocks.rename).toHaveBeenCalledWith(TEMPORARY_PATH, FILENAME);
  });

  it("passes the current entry and keeps other instances", async () => {
    storeCredentials({
      [INSTANCE.href]: CREDENTIAL,
      [OTHER_INSTANCE]: OTHER_CREDENTIAL,
    });
    const replacement = { ...CREDENTIAL, token: "c".repeat(43) };
    const operation = vi.fn(async (current: StoredCredential | null) => ({
      credential: replacement,
      result: current?.token,
    }));
    await expect(
      new CredentialStore(ENVIRONMENT).update(INSTANCE, operation),
    ).resolves.toBe(CREDENTIAL.token);
    expect(operation).toHaveBeenCalledWith(CREDENTIAL);
    expect(writtenCredentials()).toEqual({
      [INSTANCE.href]: replacement,
      [OTHER_INSTANCE]: OTHER_CREDENTIAL,
    });
  });

  it("deletes the entry when the operation returns no credential", async () => {
    storeCredentials({
      [INSTANCE.href]: CREDENTIAL,
      [OTHER_INSTANCE]: OTHER_CREDENTIAL,
    });
    await expect(
      new CredentialStore(ENVIRONMENT).update(INSTANCE, async () => ({
        credential: null,
        result: "removed",
      })),
    ).resolves.toBe("removed");
    expect(writtenCredentials()).toEqual({
      [OTHER_INSTANCE]: OTHER_CREDENTIAL,
    });
  });
});

describe("CredentialStore.update lock release", () => {
  it("releases the lock after the rename", async () => {
    await new CredentialStore(ENVIRONMENT).update(INSTANCE, async () => ({
      credential: CREDENTIAL,
      result: undefined,
    }));
    const lockHandle = handles.get(LOCK_PATH);
    expect(lockHandle?.close).toHaveBeenCalledOnce();
    expect(mocks.unlink).toHaveBeenCalledExactlyOnceWith(LOCK_PATH);
    const renameOrder = mocks.rename.mock.invocationCallOrder[0] ?? Infinity;
    const unlinkOrder = mocks.unlink.mock.invocationCallOrder[0] ?? -Infinity;
    expect(renameOrder).toBeLessThan(unlinkOrder);
  });

  it("refuses an insecure directory before locking", async () => {
    entries.set(DIRECTORY, {
      kind: "directory",
      permissions: 0o755,
      uid: USER_ID,
    });
    const operation = vi.fn();
    await expect(
      new CredentialStore(ENVIRONMENT).update(INSTANCE, operation),
    ).rejects.toBeInstanceOf(CredentialStoreError);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
  });

  it("releases the lock when the operation fails", async () => {
    const failure = new Error("synthetic operation failure");
    await expect(
      new CredentialStore(ENVIRONMENT).update(INSTANCE, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(handles.get(LOCK_PATH)?.close).toHaveBeenCalledOnce();
    expect(mocks.unlink).toHaveBeenCalledExactlyOnceWith(LOCK_PATH);
    expect(handles.has(TEMPORARY_PATH)).toBe(false);
  });

  it("releases the lock when the stored file is invalid", async () => {
    storeFile("[]");
    const operation = vi.fn();
    await expect(
      new CredentialStore(ENVIRONMENT).update(INSTANCE, operation),
    ).rejects.toThrow(new CredentialStoreError(DEFAULT_MESSAGE));
    expect(operation).not.toHaveBeenCalled();
    expect(mocks.unlink).toHaveBeenCalledExactlyOnceWith(LOCK_PATH);
  });
});

describe("CredentialStore lock", () => {
  const keepCredential = async (): Promise<{
    credential: StoredCredential;
    result: string;
  }> => ({ credential: CREDENTIAL, result: "done" });

  it("retries while another process holds the lock", async () => {
    mocks.open
      .mockRejectedValueOnce(codedError("EEXIST"))
      .mockRejectedValueOnce(codedError("EEXIST"));
    await expect(
      new CredentialStore(ENVIRONMENT).update(INSTANCE, keepCredential),
    ).resolves.toBe("done");
    expect(mocks.delay).toHaveBeenCalledTimes(2);
    expect(mocks.delay).toHaveBeenCalledWith(100);
    expect(mocks.open).toHaveBeenCalledTimes(4);
    expect(mocks.unlink).toHaveBeenCalledExactlyOnceWith(LOCK_PATH);
  });

  it("gives up after 100 attempts", async () => {
    mocks.open.mockRejectedValue(codedError("EEXIST"));
    const operation = vi.fn();
    await expect(
      new CredentialStore(ENVIRONMENT).update(INSTANCE, operation),
    ).rejects.toThrow(new CredentialStoreError(LOCKED_MESSAGE));
    expect(mocks.open).toHaveBeenCalledTimes(100);
    expect(mocks.delay).toHaveBeenCalledTimes(100);
    expect(operation).not.toHaveBeenCalled();
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it.each([
    ["a string", "synthetic failure"],
    ["null", null],
    ["an error without code", new Error("synthetic failure")],
    ["a permission error", codedError("EACCES")],
  ])("fails without retry on %s", async (_, failure) => {
    mocks.open.mockRejectedValue(failure);
    await expect(
      new CredentialStore(ENVIRONMENT).update(INSTANCE, keepCredential),
    ).rejects.toThrow(new CredentialStoreError(DEFAULT_MESSAGE));
    expect(mocks.open).toHaveBeenCalledOnce();
    expect(mocks.delay).not.toHaveBeenCalled();
  });
});

describe("CredentialStore write failures", () => {
  const keepCredential = async (): Promise<{
    credential: StoredCredential;
    result: string;
  }> => ({ credential: CREDENTIAL, result: "done" });

  it("closes and removes the temporary file when writing fails", async () => {
    const failure = new Error("synthetic write failure");
    writeFailures.set(TEMPORARY_PATH, failure);
    await expect(
      new CredentialStore(ENVIRONMENT).update(INSTANCE, keepCredential),
    ).rejects.toBe(failure);
    const temporaryHandle = handles.get(TEMPORARY_PATH);
    expect(temporaryHandle?.sync).not.toHaveBeenCalled();
    expect(temporaryHandle?.close).toHaveBeenCalledOnce();
    expect(mocks.unlink).toHaveBeenCalledWith(TEMPORARY_PATH);
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(mocks.unlink).toHaveBeenLastCalledWith(LOCK_PATH);
  });

  it("removes the temporary file when the rename fails", async () => {
    const failure = codedError("EXDEV");
    mocks.rename.mockRejectedValue(failure);
    await expect(
      new CredentialStore(ENVIRONMENT).update(INSTANCE, keepCredential),
    ).rejects.toBe(failure);
    expect(mocks.unlink).toHaveBeenNthCalledWith(1, TEMPORARY_PATH);
    expect(mocks.unlink).toHaveBeenNthCalledWith(2, LOCK_PATH);
    expect(handles.get(LOCK_PATH)?.close).toHaveBeenCalledOnce();
  });
});
