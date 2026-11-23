import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CliGitHubCredentials } from "@/backend/agents/cli/CliGitHubCredentials";

import type * as FsModule from "node:fs/promises";
import type * as TempDirectoryModule from "@/backend/config/PagesTempDirectory";
import type { CliGitHubAccess } from "@/backend/agents/cli/CliGitHubCredentials";
import type { GitHubWriteAccess } from "@/backend/github/GitHubGitAccess";

interface BridgeCall {
  readonly instanceId: string;
  readonly socketPath: string;
  readonly capability: string;
}

const mocks = vi.hoisted(() => ({
  root: { current: "" },
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
  chmod: vi.fn(),
  rm: vi.fn(),
  openCliGitBridge: vi.fn<(options: BridgeCall) => Promise<unknown>>(),
  writeGitBridgeClient: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
  logDiagnostic: mocks.logDiagnostic,
}));
vi.mock("@/backend/config/PagesTempDirectory", () => ({
  pagesTempDirectory: (...parts: readonly string[]) =>
    [mocks.root.current, "tmp", ...parts].join("/"),
}));
vi.mock("@/backend/agents/cli/CliGitBridge", () => ({
  openCliGitBridge: mocks.openCliGitBridge,
  writeGitBridgeClient: mocks.writeGitBridgeClient,
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof FsModule>()),
  chmod: mocks.chmod,
  rm: mocks.rm,
}));

const { pagesTempDirectory: realTempDirectory } = await vi.importActual<
  typeof TempDirectoryModule
>("@/backend/config/PagesTempDirectory");

const INSTANCE_ID = "0b1c2d3e-4f50-4162-8394-a5b6c7d8e9f0";
const TOKEN = "ghp_synthetic/token+value";
const GH = "/opt/gh/bin/gh";
let dataDirectory = "";

beforeEach(async () => {
  const actual = await vi.importActual<typeof FsModule>("node:fs/promises");
  mocks.chmod.mockImplementation(actual.chmod);
  mocks.rm.mockImplementation(actual.rm);
  const base = realTempDirectory("credentials-test");
  await mkdir(base, { recursive: true, mode: 0o700 });
  mocks.root.current = await mkdtemp(path.join(base, "run-"));
  dataDirectory = path.join(mocks.root.current, "data");
  await mkdir(dataDirectory);
});

afterEach(async () => {
  for (const entry of await readdir(mocks.root.current, { recursive: true }))
    await mocks.chmod(path.join(mocks.root.current, entry), 0o700);
  await rm(mocks.root.current, { recursive: true, force: true });
});

function availableAccess(writeAccess: GitHubWriteAccess = "verified"): {
  readonly status: "available";
  readonly repository: string;
  readonly token: string;
  readonly writeAccess: GitHubWriteAccess;
} {
  return {
    status: "available",
    repository: "Owner/Repo",
    token: TOKEN,
    writeAccess,
  };
}

async function prepareToken(
  writeAccess: GitHubWriteAccess = "verified",
): Promise<CliGitHubAccess> {
  return new CliGitHubCredentials(dataDirectory).prepare({
    instanceId: INSTANCE_ID,
    access: availableAccess(writeAccess),
    gh: GH,
    searchPath: "/usr/bin",
  });
}

function gitConfig(access: CliGitHubAccess): [string, string][] {
  const count = Number(access.environment.GIT_CONFIG_COUNT);
  return [...Array(count).keys()].map((index) => [
    access.environment[`GIT_CONFIG_KEY_${index}`] ?? "",
    access.environment[`GIT_CONFIG_VALUE_${index}`] ?? "",
  ]);
}

it("prepares a protected gh home with the token, a helper and a publish script", async () => {
  const access = await prepareToken();
  const { directory, environment } = access;
  expect(path.dirname(directory)).toBe(await realpath(dataDirectory));
  expect(path.basename(directory)).toMatch(
    new RegExp(`^acp-github-${INSTANCE_ID}-`, "u"),
  );
  expect((await stat(directory)).mode & 0o777).toBe(0o500);
  for (const file of [
    "config.yml",
    "hosts.yml",
    "git-credential.sh",
    "git-publish.sh",
  ])
    expect((await stat(path.join(directory, file))).mode & 0o777).toBe(0o400);
  expect(await readFile(path.join(directory, "hosts.yml"), "utf8")).toContain(
    `oauth_token: ${JSON.stringify(TOKEN)}`,
  );
  expect(environment).toMatchObject({
    GH_CONFIG_DIR: directory,
    GH_REPO: "Owner/Repo",
    PATH: "/opt/gh/bin:/usr/bin",
    PAGES_GITHUB_ACCESS:
      "project connection for Owner/Repo: push access verified at session start",
    PAGES_GIT_PUBLISH: path.join(directory, "git-publish.sh"),
    GIT_CONFIG_COUNT: "5",
  });
  expect(Object.values(environment)).not.toContain(TOKEN);
  expect(gitConfig(access)).toEqual([
    ["credential.helper", ""],
    [
      "credential.helper",
      `!/bin/sh '${path.join(directory, "git-credential.sh")}'`,
    ],
    ["credential.useHttpPath", "true"],
    [
      "url.https://github.com/Owner/Repo.insteadOf",
      "git@github.com:Owner/Repo",
    ],
    [
      "url.https://github.com/Owner/Repo.insteadOf",
      "ssh://git@github.com/Owner/Repo",
    ],
  ]);
  expect(await readFile(environment.PAGES_GIT_PUBLISH ?? "", "utf8")).toContain(
    "'https://github.com/owner/repo'",
  );
});

it("masks the token and its encodings in text", async () => {
  const access = await prepareToken();
  const encoded = encodeURIComponent(TOKEN);
  const basic = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
  expect(access.redact(`a ${TOKEN} b ${encoded} c ${basic}`)).toBe(
    "a [redacted] b [redacted] c [redacted]",
  );
  expect(access.secrets).toContain(TOKEN);
  expect(access.secrets).toContain(Buffer.from(TOKEN).toString("base64"));
});

it("warns in the helper when GitHub refused push access at session start", async () => {
  const denied = await prepareToken("denied");
  const script = await readFile(
    path.join(denied.directory, "git-credential.sh"),
    "utf8",
  );
  expect(script).toContain("GitHub refused push access to Owner/Repo");
  expect(denied.status).toContain(
    "GitHub refused push access at session start",
  );
  const verified = await readFile(
    path.join((await prepareToken("verified")).directory, "git-credential.sh"),
    "utf8",
  );
  expect(verified).not.toContain("GitHub refused push access");
});

it("describes every state of the write check", async () => {
  expect((await prepareToken("rejected")).status).toContain(
    "GitHub rejected the stored token at session start",
  );
  expect((await prepareToken("unknown")).status).toContain(
    "push access could not be checked at session start",
  );
});

it("hands out no credential without a token or without the GitHub CLI", async () => {
  const credentials = new CliGitHubCredentials(dataDirectory);
  const unavailable = await credentials.prepare({
    instanceId: INSTANCE_ID,
    access: { status: "unavailable", reason: "no token stored" },
    gh: GH,
    searchPath: "/usr/bin",
  });
  expect(unavailable.status).toBe("no token stored");
  expect(unavailable.environment.GH_REPO).toBeUndefined();
  expect(unavailable.environment.PAGES_GIT_PUBLISH).toBeUndefined();
  expect(unavailable.environment.GIT_CONFIG_COUNT).toBe("2");
  expect(unavailable.redact("plain")).toBe("plain");
  expect(unavailable.secrets).toEqual([]);
  expect(
    await readFile(
      path.join(unavailable.directory, "git-credential.sh"),
      "utf8",
    ),
  ).toContain("this session has no GitHub credential (no token stored)");
  expect(await readdir(unavailable.directory)).not.toContain("hosts.yml");
  const missingCli = await credentials.prepare({
    instanceId: INSTANCE_ID,
    access: availableAccess(),
    gh: null,
    searchPath: "/usr/bin",
  });
  expect(missingCli.status).toBe("GitHub CLI not installed");
  expect(missingCli.environment.PATH).toBeUndefined();
});

it("records the namespace once and restores the protection afterwards", async () => {
  const access = await prepareToken();
  const owner = {
    pid: 42,
    uid: 1000,
    start: 7,
    boot: "0b1c2d3e-4f50-4162-8394-a5b6c7d8e9f0",
  };
  await access.recordNamespace(owner);
  const marker = path.join(access.directory, "namespace.json");
  expect(JSON.parse(await readFile(marker, "utf8"))).toEqual(owner);
  expect((await stat(marker)).mode & 0o777).toBe(0o400);
  expect((await stat(access.directory)).mode & 0o777).toBe(0o500);
  await expect(access.recordNamespace(owner)).rejects.toMatchObject({
    code: "EEXIST",
  });
  expect((await stat(access.directory)).mode & 0o777).toBe(0o500);
});

it("removes the whole session folder on cleanup", async () => {
  const access = await prepareToken();
  await access.cleanup();
  await expect(stat(access.directory)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("reports a safe error when cleanup cannot remove the folder", async () => {
  const access = await prepareToken();
  mocks.rm.mockRejectedValueOnce(new Error("busy"));
  await expect(access.cleanup()).rejects.toMatchObject({
    code: "credential_cleanup_failed",
  });
  expect(mocks.logCaughtError).toHaveBeenCalled();
});

it("refuses an instance id that is no UUID", async () => {
  await expect(
    new CliGitHubCredentials(dataDirectory).prepare({
      instanceId: "../escape",
      access: availableAccess(),
      gh: GH,
      searchPath: "/usr/bin",
    }),
  ).rejects.toMatchObject({ code: "secret_unavailable" });
  expect(await readdir(dataDirectory)).toEqual([]);
});

it("removes the folder of a failed preparation and reports a safe error", async () => {
  mocks.chmod.mockRejectedValueOnce(new Error("denied"));
  await expect(prepareToken()).rejects.toMatchObject({
    code: "secret_unavailable",
  });
  expect(await readdir(dataDirectory)).toEqual([]);
});

it("reports a failed removal after a failed preparation", async () => {
  mocks.chmod.mockRejectedValueOnce(new Error("denied"));
  mocks.rm.mockRejectedValueOnce(new Error("busy"));
  await expect(prepareToken()).rejects.toMatchObject({
    code: "credential_cleanup_failed",
  });
});

it("prepares a runner folder below the temporary directory of Pages", async () => {
  const access = await new CliGitHubCredentials(dataDirectory).prepare({
    runner: true,
    instanceId: INSTANCE_ID,
    access: { status: "unavailable", reason: "none" },
    gh: null,
    searchPath: "/usr/bin",
  });
  expect(path.basename(access.directory)).toMatch(
    new RegExp(`^runner-github-${INSTANCE_ID}-`, "u"),
  );
  expect(path.basename(path.dirname(access.directory))).toBe("runner-github");
  expect(await readdir(dataDirectory)).toEqual([]);
});

function grant(pushRefs: readonly string[]): {
  readonly repository: string;
  readonly sshAlias: string;
  readonly pushRefs: readonly string[];
  readonly isAuthorized: () => Promise<boolean>;
} {
  return {
    repository: "owner/bridged",
    sshAlias: "alias",
    pushRefs,
    isAuthorized: async () => true,
  };
}

function bridgeCall(): BridgeCall {
  const call = mocks.openCliGitBridge.mock.calls[0]?.[0];
  if (call === undefined) throw new Error("The bridge was not opened");
  return call;
}

it("routes the bridged repository through the host bridge of the session", async () => {
  const close = vi.fn(async () => undefined);
  mocks.openCliGitBridge.mockImplementation(
    async ({ socketPath }: BridgeCall) => {
      await mkdir(socketPath);
      return { close };
    },
  );
  const access = await new CliGitHubCredentials(dataDirectory).prepare({
    instanceId: INSTANCE_ID,
    access: availableAccess(),
    gh: GH,
    searchPath: "/usr/bin",
    bridge: grant(["refs/heads/a", "refs/heads/b"]),
  });
  const { capability, socketPath } = bridgeCall();
  const clientFile = path.join(access.directory, "git-bridge-client.cjs");
  expect(mocks.writeGitBridgeClient).toHaveBeenCalledWith(
    clientFile,
    socketPath,
    capability,
  );
  expect(socketPath).toBe(path.join(access.directory, "git-bridge.sock"));
  expect(access.status).toBe(
    "project connection for Owner/Repo: push access verified at session start; Git for owner/bridged uses the host bridge (fetch and push to refs/heads/a, refs/heads/b)",
  );
  expect(access.environment.PAGES_GITHUB_ACCESS).toBe(access.status);
  expect(gitConfig(access).map(([key]) => key)).toEqual([
    "credential.helper",
    "credential.helper",
    "credential.useHttpPath",
    "url.ssh://git@github.com/owner/bridged.insteadOf",
    "url.ssh://git@github.com/owner/bridged.insteadOf",
    "url.ssh://git@github.com/owner/bridged.insteadOf",
    "core.sshCommand",
    "ssh.variant",
  ]);
  expect(gitConfig(access)[5]).toEqual([
    "url.ssh://git@github.com/owner/bridged.insteadOf",
    "git@alias:owner/bridged",
  ]);
  expect(gitConfig(access)[6]?.[1]).toBe(
    `'${process.execPath}' '${clientFile}'`,
  );
  expect(
    await readFile(access.environment.PAGES_GIT_PUBLISH ?? "", "utf8"),
  ).toContain("'ssh://git@github.com/owner/bridged'");
  expect(access.redact(`x ${capability} ${TOKEN}`)).toBe(
    "x [redacted] [redacted]",
  );
  expect(access.secrets).toContain(capability);
  await access.cleanup();
  expect(close).toHaveBeenCalledOnce();
  await expect(stat(access.directory)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("states a bridge that only fetches and works without a stored token", async () => {
  mocks.openCliGitBridge.mockResolvedValue({ close: async () => undefined });
  const access = await new CliGitHubCredentials(dataDirectory).prepare({
    instanceId: INSTANCE_ID,
    access: { status: "unavailable", reason: "no token stored" },
    gh: null,
    searchPath: "/usr/bin",
    bridge: grant([]),
  });
  expect(access.status).toBe(
    "no token stored; Git for owner/bridged uses the host bridge (fetch only)",
  );
  expect(gitConfig(access).map(([key]) => key)).not.toContain(
    "credential.useHttpPath",
  );
  expect(access.secrets).toEqual([bridgeCall().capability]);
  await access.cleanup();
});

it("removes the folder when the bridge cannot start", async () => {
  mocks.openCliGitBridge.mockRejectedValue(new Error("no socket"));
  await expect(
    new CliGitHubCredentials(dataDirectory).prepare({
      instanceId: INSTANCE_ID,
      access: availableAccess(),
      gh: GH,
      searchPath: "/usr/bin",
      bridge: grant([]),
    }),
  ).rejects.toMatchObject({ code: "secret_unavailable" });
  expect(await readdir(dataDirectory)).toEqual([]);
});
