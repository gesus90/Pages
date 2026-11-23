import { expect, it, vi } from "vitest";

import { readJournaledWorkerUnitEnds } from "@/backend/agents/cli/CliWorkerUnitJournal";

import type { Mock } from "vitest";
import type { CliWorkerCommand } from "@/backend/agents/cli/CliWorkerUnit";

const process = vi.hoisted(() => ({ execFile: vi.fn() }));

vi.mock("node:child_process", () => process);

const STARTED = "7d4958e842da4a758f6c1cdc7b36dcc5";
const STARTED_ALTERNATIVE = "39f53479d3a045ac8e11786248231fbf";
const ENDED = "9d1aaa27d60140bd96365438aad20286";
const SINCE = "2026-01-01T00:00:00.000Z";

function entry(unit: string | null, message: string | null): string {
  return JSON.stringify({
    ...(unit === null ? {} : { USER_UNIT: unit }),
    ...(message === null ? {} : { MESSAGE_ID: message }),
  });
}

function unitName(tag: string): string {
  return `pages-acp-${tag}-0123abcd.service`;
}

function commandOf(lines: readonly string[]): Mock<CliWorkerCommand> {
  return vi.fn(async () => ({ stdout: lines.join("\n") }));
}

it("marks a session ended when its only unit started and ended", async () => {
  const command = commandOf([
    entry(unitName("alpha"), STARTED),
    "",
    "  ",
    entry(unitName("alpha"), ENDED),
    entry(unitName("beta"), STARTED_ALTERNATIVE),
    entry(unitName("gamma"), ENDED),
    entry(unitName("delta"), "0000"),
    entry("unrelated.service", STARTED),
    entry(null, STARTED),
    entry(unitName("alpha"), null),
  ]);

  const result = await readJournaledWorkerUnitEnds({ since: SINCE }, command);

  expect(result).toEqual(
    new Map([
      ["alpha", true],
      ["beta", false],
      ["gamma", false],
      ["delta", false],
    ]),
  );
});

it("treats several units of one session as no proof", async () => {
  const command = commandOf([
    entry("pages-acp-alpha-0123abcd.service", STARTED),
    entry("pages-acp-alpha-4567abcd.service", ENDED),
  ]);

  const result = await readJournaledWorkerUnitEnds({ since: SINCE }, command);

  expect(result.get("alpha")).toBe(false);
});

it("asks the journal for one tag with a slack before the start", async () => {
  const command = commandOf([]);

  await readJournaledWorkerUnitEnds(
    { since: SINCE, instanceId: "alpha-1" },
    command,
  );

  const since = Math.floor(Date.parse(SINCE) / 1000) - 300;
  expect(command).toHaveBeenCalledWith("/usr/bin/journalctl", [
    "--user",
    "--no-pager",
    "--quiet",
    "--output=json",
    "--output-fields=MESSAGE_ID,USER_UNIT",
    `--since=@${since}`,
    "--user-unit=pages-acp-alpha-1-*",
  ]);
});

it("reads all sessions and never asks for a negative start", async () => {
  const command = commandOf([]);

  await readJournaledWorkerUnitEnds({ since: "1970-01-01T00:00:00Z" }, command);

  const args = command.mock.calls[0] as unknown as [string, string[]];
  expect(args[1]).toContain("--since=@0");
  expect(args[1]).toContain("--user-unit=pages-acp-*");
});

it("rejects an invalid start and an invalid tag before reading", async () => {
  const command = commandOf([]);

  await expect(
    readJournaledWorkerUnitEnds({ since: "never" }, command),
  ).rejects.toThrow("Invalid journal start");
  await expect(
    readJournaledWorkerUnitEnds({ since: SINCE, instanceId: "a b" }, command),
  ).rejects.toThrow("Invalid session tag");
  expect(command).not.toHaveBeenCalled();
});

it("rejects journal entries that are no objects", async () => {
  await expect(
    readJournaledWorkerUnitEnds({ since: SINCE }, commandOf(["null"])),
  ).rejects.toThrow("Unreadable journal entry");
  await expect(
    readJournaledWorkerUnitEnds({ since: SINCE }, commandOf(["3"])),
  ).rejects.toThrow("Unreadable journal entry");
});

it("runs journalctl through a bounded process by default", async () => {
  process.execFile.mockImplementation(
    (
      file: string,
      args: string[],
      options: object,
      callback: (error: null, result: { stdout: string }) => void,
    ) => callback(null, { stdout: entry(unitName("alpha"), STARTED) }),
  );

  const result = await readJournaledWorkerUnitEnds({ since: SINCE });

  expect(result.get("alpha")).toBe(false);
  expect(process.execFile).toHaveBeenCalledWith(
    "/usr/bin/journalctl",
    expect.arrayContaining(["--user"]),
    expect.objectContaining({ env: { PATH: "/usr/bin:/bin" } }),
    expect.any(Function),
  );
});
