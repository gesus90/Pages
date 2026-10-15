import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CliPlanIsolation } from "@/backend/agents/cli/CliPlanIsolation";

import type { CliSessionRequest } from "@/backend/agents/cli/CliContracts";

vi.mock("node:fs/promises", () => ({
  access: async () => {},
  realpath: async (file: string) => file,
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
