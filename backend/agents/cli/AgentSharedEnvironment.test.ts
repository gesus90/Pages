import path from "node:path";

import { beforeEach, expect, it, vi } from "vitest";

import manifest from "../../../package.json";
import {
  prepareSharedAgentEnvironment,
  sharedAgentEnvironment,
  sharedPnpmBin,
} from "@/backend/agents/cli/AgentSharedEnvironment";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  lstat: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn(),
  rmdir: vi.fn(),
  writeFile: vi.fn(),
  execFile: vi.fn(),
  sleep: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  access: mocks.access,
  lstat: mocks.lstat,
  mkdir: mocks.mkdir,
  rm: mocks.rm,
  rmdir: mocks.rmdir,
  writeFile: mocks.writeFile,
}));
vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("node:timers/promises", () => ({ setTimeout: mocks.sleep }));

const VERSION = manifest.packageManager.replace(/^pnpm@/u, "");
let counter = 0;
let isInstalled = false;

function nextRoot(): string {
  counter += 1;
  return `/synthetic/shared-${counter}`;
}

function coded(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function metadata(
  overrides: {
    mode?: number;
    isDirectory?: boolean;
    isLink?: boolean;
    mtimeMs?: number;
  } = {},
): {
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
  mode: number;
  mtimeMs: number;
} {
  return {
    isDirectory: () => overrides.isDirectory ?? true,
    isSymbolicLink: () => overrides.isLink ?? false,
    mode: overrides.mode ?? 0o700,
    mtimeMs: overrides.mtimeMs ?? Date.now(),
  };
}

beforeEach(() => {
  isInstalled = false;
  mocks.access.mockImplementation(async () => {
    if (!isInstalled) throw coded("ENOENT");
  });
  mocks.lstat.mockImplementation(async () => metadata());
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.rm.mockResolvedValue(undefined);
  mocks.rmdir.mockResolvedValue(undefined);
  mocks.writeFile.mockResolvedValue(undefined);
  mocks.sleep.mockResolvedValue(undefined);
  mocks.execFile.mockImplementation(
    (
      file: string,
      args: string[],
      options: object,
      done: (error: null, result: object) => void,
    ) => {
      isInstalled = true;
      done(null, { stdout: "", stderr: "" });
    },
  );
});

it("describes the shared folders below the root", () => {
  const environment = sharedAgentEnvironment("/synthetic/root");

  expect(environment.PNPM_HOME).toBe("/synthetic/root/pnpm");
  expect(environment.PLAYWRIGHT_BROWSERS_PATH).toBe(
    "/synthetic/root/cache/ms-playwright",
  );
  expect(sharedPnpmBin("/synthetic/root")).toBe(
    path.join("/synthetic/root/pnpm", VERSION, "node_modules", ".bin"),
  );
});

it("installs the pinned pnpm once and marks it ready", async () => {
  const root = nextRoot();

  await prepareSharedAgentEnvironment(root);

  expect(mocks.mkdir).toHaveBeenCalledWith(root, {
    recursive: true,
    mode: 0o700,
  });
  expect(mocks.mkdir).toHaveBeenCalledWith(path.join(root, "pnpm-setup.lock"), {
    mode: 0o700,
  });
  expect(mocks.rmdir).toHaveBeenCalledWith(path.join(root, "pnpm-store"));
  expect(mocks.execFile).toHaveBeenCalledWith(
    "npm",
    expect.arrayContaining([`pnpm@${VERSION}`, "--ignore-scripts"]),
    expect.objectContaining({ timeout: 180_000 }),
    expect.any(Function),
  );
  expect(mocks.writeFile).toHaveBeenCalledWith(
    path.join(root, "pnpm", VERSION, "ready"),
    VERSION,
    { mode: 0o600 },
  );
  expect(mocks.rm).toHaveBeenLastCalledWith(
    path.join(root, "pnpm-setup.lock"),
    {
      recursive: true,
      force: true,
    },
  );
});

it("shares one preparation between concurrent callers and later calls", async () => {
  const root = nextRoot();

  await Promise.all([
    prepareSharedAgentEnvironment(root),
    prepareSharedAgentEnvironment(root),
  ]);
  await prepareSharedAgentEnvironment(root);

  expect(mocks.execFile).toHaveBeenCalledTimes(1);
});

it("skips the installation when pnpm is ready", async () => {
  isInstalled = true;

  await prepareSharedAgentEnvironment(nextRoot());

  expect(mocks.execFile).not.toHaveBeenCalled();
  expect(mocks.writeFile).not.toHaveBeenCalled();
});

it("leaves the work to another owner that finished while the lock was taken", async () => {
  const root = nextRoot();
  mocks.mkdir.mockImplementation(async (directory: string) => {
    if (directory.endsWith("pnpm-setup.lock")) isInstalled = true;
  });

  await prepareSharedAgentEnvironment(root);

  expect(mocks.execFile).not.toHaveBeenCalled();
  expect(mocks.rm).toHaveBeenCalledWith(path.join(root, "pnpm-setup.lock"), {
    recursive: true,
    force: true,
  });
});

it("waits while another owner holds a fresh lock", async () => {
  let attempts = 0;
  mocks.mkdir.mockImplementation(async (directory: string) => {
    if (!directory.endsWith("pnpm-setup.lock")) return;
    attempts += 1;
    if (attempts === 1) throw coded("EEXIST");
    isInstalled = true;
  });

  await prepareSharedAgentEnvironment(nextRoot());

  expect(mocks.sleep).toHaveBeenCalledWith(100);
  expect(mocks.execFile).not.toHaveBeenCalled();
});

it("removes a stale lock and a lock that vanished, then takes over", async () => {
  let attempts = 0;
  mocks.mkdir.mockImplementation(async (directory: string) => {
    if (!directory.endsWith("pnpm-setup.lock")) return;
    attempts += 1;
    if (attempts <= 2) throw coded("EEXIST");
  });
  mocks.lstat.mockImplementation(async (directory: string) => {
    if (!directory.endsWith("pnpm-setup.lock")) return metadata();
    if (attempts === 1) return metadata({ mtimeMs: 0 });
    throw coded("ENOENT");
  });

  const root = nextRoot();
  await prepareSharedAgentEnvironment(root);

  expect(mocks.rm).toHaveBeenCalledWith(path.join(root, "pnpm-setup.lock"), {
    recursive: true,
    force: true,
  });
  expect(mocks.execFile).toHaveBeenCalledTimes(1);
});

it("gives up when the lock stays taken", async () => {
  vi.useFakeTimers();
  mocks.mkdir.mockImplementation(async (directory: string) => {
    if (directory.endsWith("pnpm-setup.lock")) throw coded("EEXIST");
  });
  mocks.sleep.mockImplementation(async () => {
    vi.setSystemTime(Date.now() + 100_000);
  });
  mocks.lstat.mockImplementation(async () => metadata({ mtimeMs: Date.now() }));

  try {
    await expect(prepareSharedAgentEnvironment(nextRoot())).rejects.toThrow(
      "Shared pnpm setup timed out",
    );
  } finally {
    vi.useRealTimers();
  }
});

it("fails on a lock error that is no existing lock", async () => {
  mocks.mkdir.mockImplementation(async (directory: string) => {
    if (directory.endsWith("pnpm-setup.lock")) throw coded("EACCES");
  });
  await expect(prepareSharedAgentEnvironment(nextRoot())).rejects.toThrow(
    "EACCES",
  );

  mocks.mkdir.mockImplementation(async (directory: string) => {
    if (directory.endsWith("pnpm-setup.lock")) throw "plain failure";
  });
  await expect(prepareSharedAgentEnvironment(nextRoot())).rejects.toBe(
    "plain failure",
  );
});

it("fails on an unexpected access error and a thrown non-error", async () => {
  mocks.access.mockRejectedValueOnce(coded("EACCES"));
  await expect(prepareSharedAgentEnvironment(nextRoot())).rejects.toThrow(
    "EACCES",
  );

  mocks.access.mockRejectedValueOnce(new Error("without code"));
  await expect(prepareSharedAgentEnvironment(nextRoot())).rejects.toThrow(
    "without code",
  );

  mocks.access.mockRejectedValueOnce("plain failure");
  await expect(prepareSharedAgentEnvironment(nextRoot())).rejects.toBe(
    "plain failure",
  );
});

it("ignores a legacy store that is missing, busy or no folder", async () => {
  for (const code of ["ENOENT", "ENOTEMPTY", "EEXIST", "ENOTDIR"]) {
    isInstalled = true;
    mocks.rmdir.mockRejectedValueOnce(coded(code));
    await prepareSharedAgentEnvironment(nextRoot());
  }

  expect(mocks.rmdir).toHaveBeenCalledTimes(4);
});

it("fails when the legacy store cannot be removed for another reason", async () => {
  mocks.rmdir.mockRejectedValueOnce(coded("EACCES"));
  await expect(prepareSharedAgentEnvironment(nextRoot())).rejects.toThrow(
    "EACCES",
  );

  mocks.rmdir.mockRejectedValueOnce(new Error("without code"));
  await expect(prepareSharedAgentEnvironment(nextRoot())).rejects.toThrow(
    "without code",
  );

  mocks.rmdir.mockRejectedValueOnce("plain failure");
  await expect(prepareSharedAgentEnvironment(nextRoot())).rejects.toBe(
    "plain failure",
  );
});

it("refuses folders that are links, no folders or writable by others", async () => {
  for (const unsafe of [
    metadata({ isDirectory: false }),
    metadata({ isLink: true }),
    metadata({ mode: 0o770 }),
    metadata({ mode: 0o707 }),
  ]) {
    mocks.lstat.mockResolvedValue(unsafe);
    await expect(prepareSharedAgentEnvironment(nextRoot())).rejects.toThrow(
      "Unsafe shared agent environment",
    );
  }
  expect(mocks.execFile).not.toHaveBeenCalled();
});

it("retries a failed preparation and removes the lock after a failed installation", async () => {
  const root = nextRoot();
  mocks.execFile.mockImplementationOnce(
    (
      file: string,
      args: string[],
      options: object,
      done: (error: Error) => void,
    ) => done(new Error("npm failed")),
  );

  await expect(prepareSharedAgentEnvironment(root)).rejects.toThrow(
    "npm failed",
  );
  expect(mocks.writeFile).not.toHaveBeenCalled();
  expect(mocks.rm).toHaveBeenLastCalledWith(
    path.join(root, "pnpm-setup.lock"),
    {
      recursive: true,
      force: true,
    },
  );

  await prepareSharedAgentEnvironment(root);
  expect(mocks.writeFile).toHaveBeenCalledTimes(1);
});
