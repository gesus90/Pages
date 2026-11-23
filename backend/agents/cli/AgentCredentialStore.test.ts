import path from "node:path";

import { beforeEach, expect, it, vi } from "vitest";

import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";

import type * as FileSystem from "node:fs/promises";

const mocks = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  requireBoundAntigravityHome: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
}));
vi.mock("@/backend/agents/cli/AntigravityContextBinding", async (original) => ({
  ...(await original<object>()),
  requireBoundAntigravityHome: mocks.requireBoundAntigravityHome,
}));

type EntryKind = "dir" | "file" | "link";

/** In-memory folder tree that implements only what the store uses. */
class FakeFiles {
  public readonly entries = new Map<string, EntryKind>();
  public readonly modes = new Map<string, number>();
  public failure: unknown = null;
  public failingPath = "";
  public failingOperation = "";

  public readonly lstat = vi.fn(async (target: string) => {
    this.fail("lstat", target);
    const kind = this.entries.get(target);
    if (kind === undefined)
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return { isDirectory: () => kind === "dir", isFile: () => kind === "file" };
  });
  public readonly mkdir = vi.fn(async (target: string) => {
    this.fail("mkdir", target);
    this.entries.set(target, "dir");
  });
  public readonly chmod = vi.fn(async (target: string, mode: number) => {
    this.modes.set(target, mode);
  });
  public readonly rm = vi.fn(async (target: string) => {
    this.fail("rm", target);
    for (const key of [...this.entries.keys()])
      if (key === target || key.startsWith(`${target}/`))
        this.entries.delete(key);
  });
  public readonly rename = vi.fn(async (source: string, target: string) => {
    this.fail("rename", source);
    this.entries.set(target, this.entries.get(source) ?? "file");
    this.entries.delete(source);
  });
  public readonly readdir = vi.fn(async (directory: string) =>
    [...this.entries]
      .filter(([key]) => path.dirname(key) === directory)
      .map(([key, kind]) => ({
        name: path.basename(key),
        isSymbolicLink: () => kind === "link",
        isDirectory: () => kind === "dir",
      })),
  );

  /** Adds entries of one kind. */
  public add(kind: EntryKind, ...targets: string[]): void {
    for (const target of targets) this.entries.set(target, kind);
  }

  /** Makes one operation on one path fail. */
  public failOn(operation: string, target: string, error: unknown): void {
    this.failingOperation = operation;
    this.failingPath = target;
    this.failure = error;
  }

  private fail(operation: string, target: string): void {
    if (this.failingOperation === operation && this.failingPath === target)
      throw this.failure;
  }
}

const ID = "11111111-2222-3333-4444-555555555555";
const OTHER_ID = "66666666-7777-8888-9999-aaaaaaaaaaaa";
const DATA = "/synthetic/data";
const ROOT = "/synthetic/data/agents";
const HOME_ROOT = `${ROOT}/${ID}`;
const LOGIN_ROOT = `${HOME_ROOT}/login`;
const BINDING = { connectionId: ID, root: "/synthetic/bound" };
const TOKEN = "antigravity-oauth-token";

let files: FakeFiles;

function storeOf(binding: typeof BINDING | null = null): AgentCredentialStore {
  return new AgentCredentialStore(
    DATA,
    files as unknown as typeof FileSystem,
    binding,
  );
}

function populateHome(root: string): void {
  files.add("dir", ROOT, root, `${root}/home`, `${root}/work`);
}

beforeEach(() => {
  files = new FakeFiles();
  mocks.requireBoundAntigravityHome.mockResolvedValue(undefined);
});

it("resolves the folders of a connection without creating anything", () => {
  expect(storeOf().paths(ID, "codex_cli")).toEqual({
    root: HOME_ROOT,
    home: `${HOME_ROOT}/home`,
    config: `${HOME_ROOT}/codex`,
    work: `${HOME_ROOT}/work`,
    sharedEnvironment: "/synthetic/data/shared-env",
  });
  expect(storeOf().paths(ID, "antigravity").config).toBe(
    `${HOME_ROOT}/antigravity`,
  );
  expect(files.mkdir).not.toHaveBeenCalled();
});

it("rejects an identifier that is no UUID", () => {
  expect(() => storeOf().paths("../escape", "codex_cli")).toThrow(
    expect.objectContaining({ code: "connection_not_found" }),
  );
});

it("maps only the bound Antigravity connection to the operator context", () => {
  const store = storeOf(BINDING);

  expect(store.isBound(ID, "antigravity")).toBe(true);
  expect(store.isBound(ID, "codex_cli")).toBe(false);
  expect(store.isBound(OTHER_ID, "antigravity")).toBe(false);
  expect(storeOf().isBound(ID, "antigravity")).toBe(false);
  expect(store.paths(ID, "antigravity")).toMatchObject({
    root: BINDING.root,
    sharedEnvironment: "/synthetic/data/shared-env",
  });
  expect(store.paths(OTHER_ID, "antigravity").root).toBe(`${ROOT}/${OTHER_ID}`);
  expect(store.paths(ID, "codex_cli").root).toBe(HOME_ROOT);
});

it("uses the connection folder for logins other than a personal Antigravity one", () => {
  expect(storeOf().loginPaths(ID, "claude_code").root).toBe(HOME_ROOT);
  expect(storeOf(BINDING).loginPaths(ID, "antigravity").root).toBe(
    BINDING.root,
  );
  expect(storeOf().loginPaths(ID, "antigravity")).toMatchObject({
    root: LOGIN_ROOT,
    home: `${LOGIN_ROOT}/home`,
    config: `${LOGIN_ROOT}/antigravity`,
    work: `${LOGIN_ROOT}/work`,
  });
});

it("creates the owner-only folders of a connection and secures what exists", async () => {
  files.add("dir", ROOT);
  files.add("file", `${HOME_ROOT}/config/auth.json`);
  files.add("link", `${HOME_ROOT}/shortcut`);

  const home = await storeOf().prepare(ID, "codex_cli");

  expect(home.root).toBe(HOME_ROOT);
  for (const directory of [
    HOME_ROOT,
    `${HOME_ROOT}/home/config`,
    `${HOME_ROOT}/home/data`,
    `${HOME_ROOT}/home/state`,
    `${HOME_ROOT}/codex`,
  ])
    expect(files.modes.get(directory)).toBe(0o700);
  files.add("file", `${HOME_ROOT}/codex/auth.json`);
  await storeOf().secure(ID, "codex_cli");
  expect(files.modes.get(`${HOME_ROOT}/codex/auth.json`)).toBe(0o600);
  expect(files.modes.has(`${HOME_ROOT}/shortcut`)).toBe(false);
});

it("refuses a connection folder that is no directory", async () => {
  files.add("dir", ROOT);
  files.add("file", HOME_ROOT);

  await expect(storeOf().prepare(ID, "codex_cli")).rejects.toMatchObject({
    code: "cli_not_executable",
  });
  expect(mocks.logCaughtError).toHaveBeenCalled();
});

it("only verifies a bound context on prepare and secure", async () => {
  const store = storeOf(BINDING);

  await expect(store.prepare(ID, "antigravity")).resolves.toMatchObject({
    root: BINDING.root,
  });
  await store.secure(ID, "antigravity");

  expect(mocks.requireBoundAntigravityHome).toHaveBeenCalledTimes(2);
  expect(files.mkdir).not.toHaveBeenCalled();
});

it("reports a bound context that fails verification as not executable", async () => {
  mocks.requireBoundAntigravityHome.mockRejectedValue(new Error("unsafe"));
  const store = storeOf(BINDING);

  await expect(store.prepare(ID, "antigravity")).rejects.toMatchObject({
    code: "cli_not_executable",
  });
  await expect(store.secure(ID, "antigravity")).rejects.toMatchObject({
    code: "cli_not_executable",
  });
});

it("refuses to secure a missing or non-directory connection", async () => {
  await expect(storeOf().secure(ID, "codex_cli")).rejects.toMatchObject({
    code: "cli_not_executable",
  });
  files.add("dir", ROOT);
  files.add("file", HOME_ROOT);
  await expect(storeOf().secure(ID, "codex_cli")).rejects.toMatchObject({
    code: "cli_not_executable",
  });
});

it("recurses through directories when securing", async () => {
  populateHome(HOME_ROOT);
  files.add("dir", `${HOME_ROOT}/codex`);
  files.add("file", `${HOME_ROOT}/codex/nested.json`);

  await storeOf().secure(ID, "codex_cli");

  expect(files.modes.get(`${HOME_ROOT}/codex`)).toBe(0o700);
  expect(files.modes.get(`${HOME_ROOT}/codex/nested.json`)).toBe(0o600);
});

it("removes the connection folder and keeps a bound or missing one", async () => {
  await storeOf(BINDING).remove(ID, "antigravity");
  await storeOf().remove(ID, "codex_cli");
  files.add("dir", ROOT);
  await storeOf().remove(ID, "codex_cli");
  expect(files.rm).not.toHaveBeenCalled();

  populateHome(HOME_ROOT);
  await storeOf().remove(ID, "codex_cli");

  expect(files.rm).toHaveBeenCalledWith(HOME_ROOT, {
    recursive: true,
    force: true,
  });
  expect(files.entries.has(HOME_ROOT)).toBe(false);
});

it("reports each removal failure as failed cleanup", async () => {
  populateHome(HOME_ROOT);
  files.failOn("rm", HOME_ROOT, new Error("busy"));
  await expect(storeOf().remove(ID, "codex_cli")).rejects.toMatchObject({
    code: "credential_cleanup_failed",
  });

  files.failOn("", "", null);
  files.entries.set(HOME_ROOT, "file");
  await expect(storeOf().remove(ID, "codex_cli")).rejects.toMatchObject({
    code: "credential_cleanup_failed",
  });
});

it("treats every unexpected status error as a failure and logs it", async () => {
  for (const error of ["plain", null, {}, { code: "EACCES" }]) {
    files.failOn("lstat", ROOT, error);
    await expect(storeOf().remove(ID, "codex_cli")).rejects.toMatchObject({
      code: "credential_cleanup_failed",
    });
  }
  expect(mocks.logCaughtError).toHaveBeenCalledWith(
    "AgentCredentialStore",
    "plain",
  );
});

it("prepares a fresh staging context for a personal Antigravity login", async () => {
  files.add("dir", ROOT, HOME_ROOT, LOGIN_ROOT);
  files.add("file", `${LOGIN_ROOT}/stale`);

  const login = await storeOf().prepareLogin(ID, "antigravity");

  expect(login.root).toBe(LOGIN_ROOT);
  expect(files.entries.has(`${LOGIN_ROOT}/stale`)).toBe(false);
  expect(files.entries.get(`${LOGIN_ROOT}/home/state`)).toBe("dir");
  expect(files.entries.get(login.config)).toBe("dir");
});

it("prepares a staging context that does not exist yet", async () => {
  const login = await storeOf().prepareLogin(ID, "antigravity");

  expect(files.entries.get(login.work)).toBe("dir");
});

it("logs in inside the connection for other CLIs and bound contexts", async () => {
  const home = await storeOf().prepareLogin(ID, "claude_code");
  expect(home.root).toBe(HOME_ROOT);

  const bound = await storeOf(BINDING).prepareLogin(ID, "antigravity");
  expect(bound.root).toBe(BINDING.root);
});

it("reports a failing staging context as not executable", async () => {
  populateHome(HOME_ROOT);
  files.add("file", LOGIN_ROOT);

  await expect(storeOf().prepareLogin(ID, "antigravity")).rejects.toMatchObject(
    { code: "cli_not_executable" },
  );
});

it("discards a staging context and leaves other logins alone", async () => {
  await storeOf().discardLogin(ID, "codex_cli");
  await storeOf(BINDING).discardLogin(ID, "antigravity");
  expect(files.rm).not.toHaveBeenCalled();

  files.add("dir", LOGIN_ROOT);
  await storeOf().discardLogin(ID, "antigravity");
  expect(files.entries.has(LOGIN_ROOT)).toBe(false);

  files.add("file", LOGIN_ROOT);
  await expect(storeOf().discardLogin(ID, "antigravity")).rejects.toMatchObject(
    { code: "credential_cleanup_failed" },
  );
});

const SOURCE = `${LOGIN_ROOT}/antigravity/antigravity-acp`;
const TARGET = `${HOME_ROOT}/antigravity/antigravity-acp`;

it("moves a confirmed sign-in into the connection", async () => {
  files.add("dir", HOME_ROOT);
  files.add("file", `${SOURCE}/settings.json`, `${SOURCE}/${TOKEN}`);

  await storeOf().adoptLogin(ID, "antigravity");

  expect(files.entries.get(`${TARGET}/settings.json`)).toBe("file");
  expect(files.entries.get(`${TARGET}/${TOKEN}`)).toBe("file");
  expect(files.entries.has(`${SOURCE}/${TOKEN}`)).toBe(false);
});

it("moves a token that comes without settings and skips an existing target folder", async () => {
  files.add("dir", HOME_ROOT, `${HOME_ROOT}/antigravity`, TARGET);
  files.add("file", `${SOURCE}/${TOKEN}`);

  await storeOf().adoptLogin(ID, "antigravity");

  expect(files.entries.get(`${TARGET}/${TOKEN}`)).toBe("file");
  expect(files.rename).toHaveBeenCalledTimes(1);
});

it("keeps the account when the login stored no token", async () => {
  files.add("file", `${SOURCE}/settings.json`);
  await expect(storeOf().adoptLogin(ID, "antigravity")).rejects.toMatchObject({
    code: "cli_not_logged_in",
  });

  files.entries.clear();
  await expect(storeOf().adoptLogin(ID, "antigravity")).rejects.toMatchObject({
    code: "cli_not_logged_in",
  });
});

it("refuses login files that are no regular files", async () => {
  files.add("dir", `${SOURCE}/${TOKEN}`);

  await expect(storeOf().adoptLogin(ID, "antigravity")).rejects.toMatchObject({
    code: "antigravity_configuration_unmanaged",
  });
});

it("reports a failing move as not executable", async () => {
  files.add("dir", HOME_ROOT);
  files.add("file", `${SOURCE}/${TOKEN}`);
  files.failOn("rename", `${SOURCE}/${TOKEN}`, new Error("denied"));

  await expect(storeOf().adoptLogin(ID, "antigravity")).rejects.toMatchObject({
    code: "cli_not_executable",
  });
});

it("adopts nothing for logins that write into the connection itself", async () => {
  await storeOf().adoptLogin(ID, "codex_cli");
  await storeOf(BINDING).adoptLogin(ID, "antigravity");

  expect(files.lstat).not.toHaveBeenCalled();
});
