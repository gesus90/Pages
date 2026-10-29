import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CliGitHubCredentials } from "@/backend/agents/cli/CliGitHubCredentials";
import { settleOwnedNamespace } from "@/backend/agents/cli/CliOwnedNamespace";

import type * as CliOwnedNamespace from "@/backend/agents/cli/CliOwnedNamespace";

const scan = vi.hoisted(() => ({
  endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
  readScopeSince: vi.fn(async () => ({ earliestStart: 4_200 })),
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => scan);
vi.mock("@/backend/agents/cli/CliOwnedNamespace", async (importOriginal) => ({
  ...(await importOriginal<typeof CliOwnedNamespace>()),
  settleOwnedNamespace: vi.fn(),
}));

const INSTANCE = "00603eeb-382e-4822-afc4-43c3cedb0ea1";
let dataDirectory: string;

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "pages-recover-"));
  scan.endTaggedProcesses.mockClear();
  scan.readScopeSince.mockClear();
  vi.mocked(settleOwnedNamespace).mockReset();
});

it.each([true, false])(
  "reconciles an owned credential directory only after namespace settlement: %s",
  async (ended) => {
    const credentials = new CliGitHubCredentials(dataDirectory);
    const access = await credentials.prepare({
      instanceId: INSTANCE,
      access: { status: "unavailable", reason: "synthetic" },
      gh: null,
      searchPath: "/usr/bin",
    });
    const owner = {
      pid: 123,
      uid: process.getuid?.() ?? 0,
      start: 456,
      boot: "10000000-0000-4000-8000-000000000001",
    };
    await access.recordNamespace(owner);
    vi.mocked(settleOwnedNamespace).mockResolvedValueOnce(ended);
    const leftovers = await credentials.recover();
    expect(settleOwnedNamespace).toHaveBeenCalledWith(owner, INSTANCE);
    expect(scan.endTaggedProcesses).not.toHaveBeenCalled();
    expect(leftovers).toHaveLength(ended ? 0 : 1);
    expect(await readdir(dataDirectory)).toHaveLength(ended ? 0 : 1);
  },
);
afterEach(async () => {
  await rm(dataDirectory, { recursive: true, force: true });
});

it("bounds the startup scan by the creation of a leftover directory", async () => {
  await mkdir(path.join(dataDirectory, `acp-github-${INSTANCE}-abc123`));
  await new CliGitHubCredentials(dataDirectory).recover();
  expect(scan.readScopeSince).toHaveBeenCalledTimes(1);
  expect(scan.endTaggedProcesses).toHaveBeenCalledWith(INSTANCE, {
    earliestStart: 4_200,
  });
  expect(await readdir(dataDirectory)).toEqual([]);
});

it("keeps unrelated directories and reports a leftover whose session process remains", async () => {
  await mkdir(path.join(dataDirectory, "agents"));
  await mkdir(path.join(dataDirectory, `acp-github-${INSTANCE}-abc123`));
  scan.endTaggedProcesses.mockResolvedValueOnce({ found: 1, remaining: 1 });
  await expect(
    new CliGitHubCredentials(dataDirectory).recover(),
  ).resolves.toEqual([
    {
      directory: `acp-github-${INSTANCE}-abc123`,
      instanceId: INSTANCE,
      reason: "processes",
    },
  ]);
  expect(await readdir(dataDirectory)).toContain(
    `acp-github-${INSTANCE}-abc123`,
  );
});
