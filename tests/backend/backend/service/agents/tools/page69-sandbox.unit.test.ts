import { expect, it, vi } from "vitest";

import {
  CliPlanIsolation,
  probeBubblewrap,
} from "@/backend/agents/cli/CliPlanIsolation";

import type { CliSessionRequest } from "@/backend/agents/cli/CliContracts";

vi.mock("node:fs/promises", () => ({
  access: async () => undefined,
  realpath: async (file: string) => file,
}));

it("proves namespace creation rather than trusting an installed bwrap file", async () => {
  const run = vi.fn(async () => undefined);
  expect(await probeBubblewrap(run)).toBe(true);
  expect(run).toHaveBeenCalledWith(
    "/usr/bin/bwrap",
    expect.arrayContaining([
      "--unshare-pid",
      "--proc",
      "/proc",
      "--",
      "/usr/bin/true",
    ]),
  );
  run.mockRejectedValueOnce(new Error("EPERM"));
  expect(await probeBubblewrap(run)).toBe(false);
});

it("hides the service home before exposing only the workspace, read-only tools and own connection", async () => {
  const isolation = new CliPlanIsolation(
    ["/memory/home/instance/data"],
    async () => true,
    {
      hiddenDirectories: ["/memory/home"],
      readOnlyDirectories: ["/memory/home/instance/tools"],
    },
  );
  const request: CliSessionRequest = {
    file: "/memory/home/instance/tools/codex/bin",
    arguments: [],
    provider: "codex_cli",
    home: {
      root: "/memory/home/instance/data/connection",
      home: "/memory/home/instance/data/connection/home",
      config: "/memory/home/instance/data/connection/config",
      work: "/memory/home/instance/data/connection/work",
    },
    workingDirectory: "/memory/home/workspace",
    environment: {},
    timeoutMs: 0,
    signal: new AbortController().signal,
    onLine: () => undefined,
  };
  const args = (await isolation.isolate(request))?.arguments ?? [];
  const privateHome = args.indexOf("/memory/home");
  const workspace = args.indexOf(request.workingDirectory);
  const tools = args.indexOf("/memory/home/instance/tools");
  expect(args[privateHome - 1]).toBe("--tmpfs");
  expect(privateHome).toBeLessThan(workspace);
  expect(args[tools - 1]).toBe("--ro-bind");
  expect(args[args.indexOf(request.home.root) - 1]).toBe("--bind");
  expect(args).not.toContain("--unshare-user-try");
});
