import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CliGitHubCredentials } from "@/backend/agents/cli/CliGitHubCredentials";

const scan = vi.hoisted(() => ({
  endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
  readScopeSince: vi.fn(async () => ({ earliestStart: 4_200 })),
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => scan);

const INSTANCE = "00603eeb-382e-4822-afc4-43c3cedb0ea1";
let dataDirectory: string;

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "pages-recover-"));
  scan.endTaggedProcesses.mockClear();
  scan.readScopeSince.mockClear();
});
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

it("keeps unrelated directories and fails when a session process remains", async () => {
  await mkdir(path.join(dataDirectory, "agents"));
  await mkdir(path.join(dataDirectory, `acp-github-${INSTANCE}-abc123`));
  scan.endTaggedProcesses.mockResolvedValueOnce({ found: 1, remaining: 1 });
  await expect(
    new CliGitHubCredentials(dataDirectory).recover(),
  ).rejects.toThrow();
  expect(await readdir(dataDirectory)).toContain(
    `acp-github-${INSTANCE}-abc123`,
  );
});
