import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { sshConfigOverlayArguments } from "@/backend/agents/cli/CliSshConfigOverlay";
import { CliPlanIsolation } from "@/backend/agents/cli/CliPlanIsolation";

import type { CliSessionRequest } from "@/backend/agents/cli/CliContracts";

vi.mock("node:fs/promises", () => ({
  access: async () => {},
  realpath: async (file: string) => file,
}));

vi.mock("@/backend/agents/cli/CliSshConfigOverlay", () => ({
  sshConfigOverlayArguments: vi.fn(async () => [
    "--ro-bind",
    "/synthetic/ssh-copies",
    "/etc/ssh/ssh_config.d",
  ]),
}));

const REQUEST: CliSessionRequest = {
  file: "/synthetic/bin/claude-agent-acp",
  arguments: [],
  provider: "claude_code",
  home: {
    root: "/synthetic/data/agents/connection",
    home: "/synthetic/data/agents/connection/home",
    config: "/synthetic/data/agents/connection/claude",
    work: "/synthetic/data/agents/connection/work",
  },
  workingDirectory: "/synthetic/workspace",
  environment: {},
  timeoutMs: 0,
  signal: new AbortController().signal,
  onLine: () => {},
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("keeps a working probe for the life of the server", async () => {
  const probe = vi.fn(async () => true);
  const isolation = new CliPlanIsolation(["/synthetic/data"], probe);
  expect(await isolation.isolate(REQUEST)).not.toBeNull();
  vi.advanceTimersByTime(24 * 60 * 60_000);
  expect(await isolation.isolate(REQUEST)).not.toBeNull();
  expect(probe).toHaveBeenCalledTimes(1);
});

it("repeats a failed probe after a minute, so installing bubblewrap needs no restart", async () => {
  const results = [false, true];
  const probe = vi.fn(async () => results.shift() ?? true);
  const isolation = new CliPlanIsolation(["/synthetic/data"], probe);
  expect(await isolation.isolate(REQUEST)).toBeNull();
  // Within the minute the failure stands and nothing is probed again.
  vi.advanceTimersByTime(30_000);
  expect(await isolation.isolate(REQUEST)).toBeNull();
  expect(probe).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(31_000);
  const isolated = await isolation.isolate(REQUEST);
  expect(isolated?.file).toBe("/usr/bin/bwrap");
  expect(isolated?.toolFile).toBe("/synthetic/bin/claude-agent-acp");
  expect(probe).toHaveBeenCalledTimes(2);
});

it("probes once for concurrent starts", async () => {
  const probe = vi.fn(async () => true);
  const isolation = new CliPlanIsolation(["/synthetic/data"], probe);
  await Promise.all([
    isolation.isolate(REQUEST),
    isolation.isolate(REQUEST),
    isolation.isolate(REQUEST),
  ]);
  expect(probe).toHaveBeenCalledTimes(1);
});

it("mounts the workspace read-only for Nur Lesen and hides the instance folders", async () => {
  const isolation = new CliPlanIsolation(["/synthetic/data"], async () => true);
  const isolated = await isolation.isolate({
    ...REQUEST,
    isWorkingDirectoryReadOnly: true,
  });
  const args = isolated?.arguments ?? [];
  expect(args[args.indexOf("/synthetic/workspace") - 1]).toBe("--ro-bind");
  expect(args).toEqual(expect.arrayContaining(["--tmpfs", "/synthetic/data"]));
});

it("mounts the account-owned SSH drop-ins over the system folder inside the namespace", async () => {
  const isolation = new CliPlanIsolation(["/synthetic/data"], async () => true);
  const args = (await isolation.isolate(REQUEST))?.arguments ?? [];
  const mount = args.indexOf("/synthetic/ssh-copies");
  expect(args.slice(mount - 1, mount + 2)).toEqual([
    "--ro-bind",
    "/synthetic/ssh-copies",
    "/etc/ssh/ssh_config.d",
  ]);
  // The mount belongs after the root binding and before the tool starts.
  expect(mount).toBeGreaterThan(args.indexOf("/tmp"));
  expect(mount).toBeLessThan(args.indexOf("--"));
});

it("refuses a workspace inside a protected directory", async () => {
  const isolation = new CliPlanIsolation(["/synthetic"], async () => true);
  await expect(isolation.isolate(REQUEST)).rejects.toMatchObject({
    code: "workspace_path_outside_roots",
  });
});

it("mounts explicit read-only and credential paths in the isolated command", async () => {
  const isolation = new CliPlanIsolation([], async () => true, {
    readOnlyDirectories: ["/synthetic/shared"],
    hiddenDirectories: ["/synthetic/private"],
  });
  const isolated = await isolation.isolate({
    ...REQUEST,
    readOnlyFiles: ["/synthetic/file"],
    credentialDirectory: "/synthetic/credentials",
    credentialFile: {
      source: "/synthetic/source",
      target: "/synthetic/target",
    },
  });
  expect(isolated?.arguments).toEqual(
    expect.arrayContaining([
      "/synthetic/shared",
      "/synthetic/private",
      "/synthetic/file",
      "/synthetic/credentials",
      "/synthetic/source",
      "/synthetic/target",
    ]),
  );
});

it("hides the host service manager and session bus in the account runtime directory", async () => {
  vi.spyOn(process, "getuid").mockReturnValue(1234);
  const isolation = new CliPlanIsolation([], async () => true);
  const args = (await isolation.isolate(REQUEST))?.arguments ?? [];
  const runtime = args.indexOf("/run/user/1234");
  expect(args.slice(runtime - 1, runtime + 1)).toEqual([
    "--tmpfs",
    "/run/user/1234",
  ]);
  expect(args.lastIndexOf("/run/user/1234")).toBe(runtime);
});

it("keeps the host read-only and permits writes only to the workspace and connection home", async () => {
  const isolation = new CliPlanIsolation([], async () => true);
  const args = (await isolation.isolate(REQUEST))?.arguments ?? [];
  const root = args.indexOf("--ro-bind");
  expect(args.slice(root, root + 3)).toEqual(["--ro-bind", "/", "/"]);
  const writableMounts = args.flatMap((argument, index) =>
    argument === "--bind" ? [args.slice(index + 1, index + 3)] : [],
  );
  expect(writableMounts).toEqual([
    [REQUEST.workingDirectory, REQUEST.workingDirectory],
    [REQUEST.home.root, REQUEST.home.root],
  ]);
  const temporary = args.indexOf("/tmp");
  expect(args[temporary - 1]).toBe("--tmpfs");
});

it("binds plan disk scratch over /tmp and overrides all temporary and compile-cache variables", async () => {
  const isolation = new CliPlanIsolation(["/synthetic/data"], async () => true);
  const isolated = await isolation.isolate({
    ...REQUEST,
    temporaryDirectory: "/synthetic/data/run-tmp/run/step/tmp",
    environment: { TMPDIR: "/host", NODE_COMPILE_CACHE: "/host-cache" },
  });
  expect(sshConfigOverlayArguments).toHaveBeenLastCalledWith(
    "/synthetic/data/run-tmp/run/step/ssh_config.d",
  );
  const args = isolated?.arguments ?? [];
  const temporary = args.indexOf("/tmp");
  expect(args.slice(temporary - 2, temporary + 1)).toEqual([
    "--bind",
    "/synthetic/data/run-tmp/run/step/tmp",
    "/tmp",
  ]);
  expect(isolated?.environment).toMatchObject({
    TMPDIR: "/tmp",
    TEMP: "/tmp",
    TMP: "/tmp",
    NODE_COMPILE_CACHE: "/tmp/node-compile-cache",
  });
});
