import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  OpenCodeCredentialStore,
  openCodeCredentials,
} from "@/backend/agents/cli/OpenCodeCredentialStore";
import { OPENCODE_FREE_PROVIDER } from "@/definition/AgentConnection";

import type { Stats } from "node:fs";
import type * as FsPromises from "node:fs/promises";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { CliHome } from "@/backend/agents/cli/CliContracts";

const h = vi.hoisted(() => ({
  lstat: null as null | ((file: string) => Promise<unknown>),
  logCaught: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    lstat: async (file: string) =>
      (await h.lstat?.(file)) ?? actual.lstat(file),
  };
});
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: h.logCaught,
  logEvent: vi.fn(),
}));

/** Casts a partial stand-in to the type the code under test expects. */
function fake<T>(value: object): T {
  return value as T;
}

const KEY = { modelProvider: "google", apiKey: "secret-key" };
const NATIVE = JSON.stringify({ google: { type: "api", key: "secret-key" } });
const cipher = fake<InstanceSecretCipher>({
  encrypt: (scope: string, content: string) => `${scope}|${content}`,
  decrypt: (scope: string, content: string) => content.replace(`${scope}|`, ""),
});

let home: CliHome;
let directory: string;
let encrypted: string;
let legacy: string;

beforeEach(async () => {
  await mkdir(pagesTempDirectory("opencode-store-test"), { recursive: true });
  const root = await mkdtemp(pagesTempDirectory("opencode-store-test", "run-"));
  home = {
    root,
    home: path.join(root, "home"),
    config: path.join(root, "config"),
    work: path.join(root, "work"),
  };
  directory = path.join(home.config, "opencode");
  encrypted = path.join(directory, "auth.pages.encrypted");
  legacy = path.join(directory, "auth.json");
  await mkdir(directory, { recursive: true, mode: 0o700 });
});

afterEach(async () => {
  h.lstat = null;
  await rm(home.root, { recursive: true, force: true });
});

async function writePrivate(file: string, content: string): Promise<void> {
  await writeFile(file, content, { mode: 0o600 });
  await chmod(file, 0o600);
}

function facts(parts: object = {}): Stats {
  return fake<Stats>({
    isFile: () => true,
    isSymbolicLink: () => false,
    isDirectory: () => true,
    size: 10,
    mode: 0o100600,
    uid: process.getuid?.() ?? 0,
    ...parts,
  });
}

it("supplies the own key and the free provider to one child only", () => {
  const credentials = openCodeCredentials(KEY);
  expect(credentials.modelProviders).toEqual([
    OPENCODE_FREE_PROVIDER,
    "google",
  ]);
  expect(credentials.ownProvider).toBe("google");
  expect(credentials.environmentFor("google")).toEqual({
    OPENCODE_AUTH_CONTENT: NATIVE,
  });
  expect(credentials.environmentFor("other")).toEqual({});
  expect(credentials.redact('a "secret-key" b')).toBe('a "[redacted]" b');
  expect(credentials.secrets).toEqual(["secret-key", "secret-key"]);
});

it("supplies only the free provider without an own key", () => {
  const credentials = openCodeCredentials(null);
  expect(credentials.modelProviders).toEqual([OPENCODE_FREE_PROVIDER]);
  expect(credentials.ownProvider).toBeNull();
  expect(credentials.redact("plain")).toBe("plain");
});

it("stores one encrypted key and removes the legacy file", async () => {
  await writePrivate(legacy, NATIVE);
  await new OpenCodeCredentialStore(cipher).store(home, KEY);
  expect(await readFile(encrypted, "utf8")).toBe(
    `${path.basename(home.root)}|${NATIVE}`,
  );
  expect(await readdir(directory)).toEqual(["auth.pages.encrypted"]);
});

it("creates the credential directory when it is missing", async () => {
  await rm(directory, { recursive: true });
  await new OpenCodeCredentialStore(cipher).store(home, KEY);
  expect(await readdir(directory)).toEqual(["auth.pages.encrypted"]);
});

it("refuses to store without a cipher", async () => {
  await expect(new OpenCodeCredentialStore().store(home, KEY)).rejects.toEqual(
    new AgentError("secret_unavailable"),
  );
});

it("cleans up its pending file when writing fails", async () => {
  const failing = fake<InstanceSecretCipher>({
    encrypt: () => {
      throw new Error("encrypt");
    },
  });
  await expect(
    new OpenCodeCredentialStore(failing).store(home, KEY),
  ).rejects.toThrow("encrypt");
  expect(await readdir(directory)).toEqual([]);
});

it("reads the encrypted key through the cipher", async () => {
  const store = new OpenCodeCredentialStore(cipher);
  await store.store(home, KEY);
  expect(await store.readOwn(home)).toEqual(KEY);
});

it("refuses an encrypted key without a cipher", async () => {
  await writePrivate(encrypted, "data");
  await expect(new OpenCodeCredentialStore().readOwn(home)).rejects.toEqual(
    new AgentError("secret_unavailable"),
  );
});

it("falls back to a legacy native file and reports no key without one", async () => {
  const store = new OpenCodeCredentialStore();
  expect(await store.readOwn(home)).toBeNull();
  await writePrivate(legacy, NATIVE);
  expect(await store.readOwn(home)).toEqual(KEY);
});

it("refuses files that are not private regular files", async () => {
  const store = new OpenCodeCredentialStore(cipher);
  const refusal = new AgentError("cli_not_logged_in");
  await writePrivate(legacy, NATIVE);
  await chmod(legacy, 0o644);
  await expect(store.readOwn(home)).rejects.toEqual(refusal);
  await rm(legacy);
  await writePrivate(path.join(home.root, "target"), NATIVE);
  await symlink(path.join(home.root, "target"), legacy);
  await expect(store.readOwn(home)).rejects.toEqual(refusal);
  await rm(legacy);
  await writePrivate(legacy, "x".repeat(8_193));
  await expect(store.readOwn(home)).rejects.toEqual(refusal);
});

it("refuses facts of a symbolic link, a foreign owner or no owner support", async () => {
  const store = new OpenCodeCredentialStore(cipher);
  const refusal = new AgentError("cli_not_logged_in");
  await writePrivate(legacy, NATIVE);
  h.lstat = async (file) =>
    file === legacy ? facts({ isSymbolicLink: () => true }) : undefined;
  await expect(store.readOwn(home)).rejects.toEqual(refusal);
  h.lstat = async (file) =>
    file === legacy ? facts({ uid: (process.getuid?.() ?? 0) + 1 }) : undefined;
  await expect(store.readOwn(home)).rejects.toEqual(refusal);
  vi.stubGlobal("process", { ...process, getuid: undefined });
  expect(await store.readOwn(home)).toEqual(KEY);
  vi.unstubAllGlobals();
});

it("hides filesystem failures behind the login error", async () => {
  const store = new OpenCodeCredentialStore(cipher);
  const refusal = new AgentError("cli_not_logged_in");
  h.lstat = async (file) => {
    if (file === legacy)
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    return undefined;
  };
  await expect(store.readOwn(home)).rejects.toEqual(refusal);
  h.lstat = async (file) => {
    if (file === legacy) throw new Error("plain");
    return undefined;
  };
  await expect(store.readOwn(home)).rejects.toEqual(refusal);
  h.lstat = async (file) => {
    if (file === legacy) throw "text";
    return undefined;
  };
  await expect(store.readOwn(home)).rejects.toEqual(refusal);
  expect(h.logCaught).toHaveBeenCalledTimes(3);
});

it("removes managed and legacy credentials", async () => {
  await writePrivate(encrypted, "data");
  await writePrivate(legacy, NATIVE);
  const store = new OpenCodeCredentialStore(cipher);
  await store.remove(home);
  expect(await readdir(directory)).toEqual([]);
  await store.remove(home);
});

it("supplies only the Coding Plan provider for a Coding Plan key", () => {
  const credentials = openCodeCredentials({
    modelProvider: "zai-coding-plan",
    apiKey: "secret-key",
  });
  expect(credentials.modelProviders).toEqual(["zai-coding-plan"]);
  expect(credentials.ownProvider).toBe("zai-coding-plan");
});
