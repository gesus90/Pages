import { expect, it, vi } from "vitest";

import {
  ACP_WORKER_LIMITS,
  CliWorkerUnits,
  probeWorkerUnits,
} from "@/backend/agents/cli/CliWorkerUnit";

import type { CliSessionRequest } from "@/backend/agents/cli/CliContracts";
import type { CliWorkerCommand } from "@/backend/agents/cli/CliWorkerUnit";

vi.mock("node:fs/promises", () => ({
  mkdir: async () => undefined,
  writeFile: async () => undefined,
  rm: async () => undefined,
}));

const REQUEST: CliSessionRequest = {
  file: "/synthetic/bin/adapter",
  arguments: ["--synthetic"],
  provider: "claude_code",
  home: {
    root: "/synthetic/agents/connection",
    home: "/synthetic/agents/connection/home",
    config: "/synthetic/agents/connection/claude",
    work: "/synthetic/agents/connection/work",
  },
  workingDirectory: "/synthetic/workspace",
  environment: {},
  timeoutMs: 60_000,
  signal: new AbortController().signal,
  onLine: () => {},
};

function properties(args: readonly string[]): string[] {
  return args.flatMap((arg, index) => (args[index - 1] === "-p" ? [arg] : []));
}

it("starts a worker unit without a fixed memory or swap ceiling and keeps every other limit", async () => {
  const command = vi.fn<CliWorkerCommand>(async () => ({
    stdout: "SYNTHETIC=1\n",
  }));
  const units = new CliWorkerUnits("/synthetic/units", command);

  const { request } = await units.wrap(REQUEST, "synthetic-instance");

  expect(ACP_WORKER_LIMITS).toMatchObject({
    memoryMax: "infinity",
    memorySwapMax: "infinity",
  });
  expect(request.file).toBe("/usr/bin/systemd-run");
  expect(request.arguments).toEqual(
    expect.arrayContaining([
      "--user",
      "--pipe",
      "--wait",
      "--slice=pages-acp.slice",
    ]),
  );
  const set = properties(request.arguments);
  expect(set).toEqual(
    expect.arrayContaining([
      "MemoryMax=infinity",
      "MemorySwapMax=infinity",
      "TasksMax=512",
      "CPUQuota=200%",
      "OOMPolicy=kill",
      "RuntimeMaxSec=180",
      "TimeoutStopSec=5s",
      "UMask=0077",
    ]),
  );
  expect(set.filter((entry) => /^Memory(Swap)?Max=/u.test(entry))).toEqual([
    "MemoryMax=infinity",
    "MemorySwapMax=infinity",
  ]);
  // The adapter still follows `--`, inside the existing bubblewrap arguments.
  expect(request.arguments.slice(request.arguments.indexOf("--") + 1)).toEqual([
    "/synthetic/bin/adapter",
    "--synthetic",
  ]);
});

it("keeps the bounded capability probe unit at 32M because it never runs a worker", async () => {
  const command = vi.fn<CliWorkerCommand>(async () => ({ stdout: "" }));

  expect(await probeWorkerUnits(command)).toBe(true);

  const args = command.mock.calls[0]?.[1] ?? [];
  expect(properties(args)).toEqual(
    expect.arrayContaining(["MemoryMax=32M", "TasksMax=8", "OOMPolicy=kill"]),
  );
  expect(args.at(-1)).toBe("/usr/bin/true");
});
