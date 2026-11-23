import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type * as NodeFsPromises from "node:fs/promises";
import {
  CliPlanIsolation,
  probeBubblewrap,
} from "@/backend/agents/cli/CliPlanIsolation";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  execFile: vi.fn(),
  logCaughtError: vi.fn(),
  realpath: vi.fn(),
  sshConfigOverlayArguments: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFsPromises>()),
  access: mocks.access,
  realpath: mocks.realpath,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
}));
vi.mock("@/backend/agents/cli/CliSshConfigOverlay", () => ({
  sshConfigOverlayArguments: mocks.sshConfigOverlayArguments,
}));

const missing = new Set<string>();

/** Builds a deliberately partial test double typed as the parameter it replaces. */
function stub<T>(value: unknown): T {
  return value as T;
}

function baseRequest(
  overrides: Record<string, unknown> = {},
): Parameters<CliPlanIsolation["isolate"]>[0] {
  return stub({
    file: "/usr/bin/tool",
    arguments: ["--flag"],
    home: { root: "/home-root" },
    workingDirectory: "/work",
    environment: { A: "1" },
    ...overrides,
  });
}

beforeEach(() => {
  missing.clear();
  mocks.access.mockResolvedValue(undefined);
  mocks.realpath.mockImplementation(async (entry: string) => {
    if (missing.has(entry)) throw new Error("ENOENT");
    return entry;
  });
  mocks.sshConfigOverlayArguments.mockResolvedValue(["--overlay"]);
});

afterEach(() => {
  vi.useRealTimers();
});

it("proves bubblewrap with the supplied runner", async () => {
  const run = vi.fn(async () => undefined);
  expect(await probeBubblewrap(run)).toBe(true);
  expect(run).toHaveBeenCalledWith("/usr/bin/bwrap", [
    "--ro-bind",
    "/",
    "/",
    "--unshare-pid",
    "--proc",
    "/proc",
    "--",
    "/usr/bin/true",
  ]);
});

it("proves bubblewrap with a real process by default", async () => {
  mocks.execFile.mockImplementation(
    (
      file: string,
      args: string[],
      options: unknown,
      callback: (error: Error | null, result?: unknown) => void,
    ) => callback(null, { stdout: "", stderr: "" }),
  );
  expect(await probeBubblewrap()).toBe(true);
  expect(mocks.execFile).toHaveBeenCalledWith(
    "/usr/bin/bwrap",
    expect.any(Array),
    { timeout: 10_000 },
    expect.any(Function),
  );
});

it("reports a missing or failing bubblewrap as unusable", async () => {
  mocks.access.mockRejectedValueOnce(new Error("missing"));
  expect(await probeBubblewrap(vi.fn())).toBe(false);
  expect(
    await probeBubblewrap(vi.fn().mockRejectedValue(new Error("no"))),
  ).toBe(false);
  expect(mocks.logCaughtError).toHaveBeenCalledTimes(2);
});

it("refuses to wrap when bubblewrap does not work", async () => {
  const isolation = new CliPlanIsolation([], async () => false);
  expect(await isolation.isolate(baseRequest())).toBeNull();
});

it("builds a minimal namespace for a plain request", async () => {
  vi.spyOn(process, "getuid").mockReturnValue(1000);
  const isolation = new CliPlanIsolation([], async () => true);
  const wrapped = await isolation.isolate(baseRequest());
  expect(wrapped).toMatchObject({
    file: "/usr/bin/bwrap",
    toolFile: "/usr/bin/tool",
    environment: { A: "1" },
  });
  expect(wrapped?.arguments).toEqual([
    "--die-with-parent",
    "--unshare-pid",
    "--new-session",
    "--ro-bind",
    "/",
    "/",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--overlay",
    "--tmpfs",
    "/run/user/1000",
    "--bind",
    "/work",
    "/work",
    "--bind",
    "/home-root",
    "/home-root",
    "--chdir",
    "/work",
    "--",
    "/usr/bin/tool",
    "--flag",
  ]);
  expect(mocks.sshConfigOverlayArguments).toHaveBeenCalledWith(
    "/tmp/pages-ssh-config-1000",
  );
});

it("falls back to uid 0 and no runtime folder without getuid", async () => {
  const original = process.getuid;
  Object.defineProperty(process, "getuid", {
    value: undefined,
    configurable: true,
  });
  try {
    const isolation = new CliPlanIsolation([], async () => true);
    const wrapped = await isolation.isolate(baseRequest());
    expect(wrapped?.arguments).not.toContain("/run/user/0");
    expect(mocks.sshConfigOverlayArguments).toHaveBeenCalledWith(
      "/tmp/pages-ssh-config-0",
    );
  } finally {
    Object.defineProperty(process, "getuid", {
      value: original,
      configurable: true,
    });
  }
});

it("applies every optional mount of a full request", async () => {
  vi.spyOn(process, "getuid").mockReturnValue(1000);
  missing.add("/missing-protected");
  missing.add("/missing-ro");
  const isolation = new CliPlanIsolation(
    ["/data/long/inner", "/data", "/missing-protected", "/data"],
    async () => true,
    {
      readOnlyDirectories: ["/ro", "/missing-ro"],
      hiddenDirectories: ["/hidden"],
    },
  );
  const wrapped = await isolation.isolate(
    baseRequest({
      temporaryDirectory: "/plans/run/tmp",
      isWorkingDirectoryReadOnly: true,
      readOnlyFiles: ["/bundle"],
      credentialDirectory: "/cred-dir",
      credentialFile: { source: "/cred-src", target: "/cred-target" },
      home: { root: "/home-root", sharedEnvironment: "/shared" },
    }),
  );
  expect(wrapped?.environment).toMatchObject({
    A: "1",
    TMPDIR: "/tmp",
    TMP: "/tmp",
  });
  expect(wrapped?.arguments).toEqual([
    "--die-with-parent",
    "--unshare-pid",
    "--new-session",
    "--ro-bind",
    "/",
    "/",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--bind",
    "/plans/run/tmp",
    "/tmp",
    "--overlay",
    "--tmpfs",
    "/hidden",
    "--tmpfs",
    "/run/user/1000",
    "--ro-bind",
    "/work",
    "/work",
    "--tmpfs",
    "/data",
    "--tmpfs",
    "/data/long/inner",
    "--ro-bind",
    "/ro",
    "/ro",
    "--ro-bind",
    "/bundle",
    "/bundle",
    "--bind",
    "/home-root",
    "/home-root",
    "--bind",
    "/shared",
    "/shared",
    "--bind",
    "/cred-src",
    "/cred-target",
    "--ro-bind",
    "/cred-dir",
    "/cred-dir",
    "--chdir",
    "/work",
    "--",
    "/usr/bin/tool",
    "--flag",
  ]);
  expect(mocks.sshConfigOverlayArguments).toHaveBeenCalledWith(
    "/plans/run/ssh_config.d",
  );
  expect(mocks.logCaughtError).toHaveBeenCalledWith(
    "CliPlanIsolation",
    expect.any(Error),
  );
});

it("refuses a working directory inside a protected folder", async () => {
  const isolation = new CliPlanIsolation(["/work"], async () => true);
  await expect(isolation.isolate(baseRequest())).rejects.toMatchObject({
    code: "workspace_path_outside_roots",
  });
});

it("keeps a working probe and shares a probe in flight", async () => {
  const probe = vi.fn(async () => true);
  const isolation = new CliPlanIsolation([], probe);
  await Promise.all([
    isolation.isolate(baseRequest()),
    isolation.isolate(baseRequest()),
  ]);
  await isolation.isolate(baseRequest());
  expect(probe).toHaveBeenCalledTimes(1);
});

it("repeats a failed probe only after a minute", async () => {
  vi.useFakeTimers();
  const probe = vi.fn(async () => false);
  const isolation = new CliPlanIsolation([], probe);
  await isolation.isolate(baseRequest());
  vi.advanceTimersByTime(59_000);
  await isolation.isolate(baseRequest());
  expect(probe).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1000);
  probe.mockResolvedValue(true);
  expect(await isolation.isolate(baseRequest())).not.toBeNull();
  expect(probe).toHaveBeenCalledTimes(2);
});

it("lets a throwing probe fail and probes again afterwards", async () => {
  const probe = vi
    .fn<() => Promise<boolean>>()
    .mockRejectedValueOnce(new Error("probe"))
    .mockResolvedValue(true);
  const isolation = new CliPlanIsolation([], probe);
  await expect(isolation.isolate(baseRequest())).rejects.toThrow("probe");
  expect(await isolation.isolate(baseRequest())).not.toBeNull();
});
