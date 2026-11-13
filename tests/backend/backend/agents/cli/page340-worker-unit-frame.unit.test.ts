import { beforeEach, expect, it, vi } from "vitest";

import {
  CliWorkerUnits,
  hasRunningWorkerUnit,
} from "@/backend/agents/cli/CliWorkerUnit";
import { readJournaledWorkerUnitEnds } from "@/backend/agents/cli/CliWorkerUnitJournal";

import type { CliSessionRequest } from "@/backend/agents/cli/CliContracts";
import type { CliWorkerCommand } from "@/backend/agents/cli/CliWorkerUnit";

import type * as LoggerModule from "@/backend/logging/Logger";

vi.mock("@/backend/logging/Logger", async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
  logEvent: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  mkdir: async () => undefined,
  writeFile: async () => undefined,
  rm: async () => undefined,
}));

const INSTANCE = "0b6c1b1e-7d2a-4f0e-9a51-1d4f8c2e3a10";
const UNIT = `pages-acp-${INSTANCE}-0123abcd.service`;
const STARTED = "39f53479d3a045ac8e11786248231fbf";
const START_BEGUN = "7d4958e842da4a758f6c1cdc7b36dcc5";
const SUCCEEDED = "7ad2d189f7e94e70a38c781354912448";
const STOPPED = "9d1aaa27d60140bd96365438aad20286";

const REQUEST: CliSessionRequest = {
  file: "/synthetic/bin/adapter",
  arguments: [],
  provider: "codex_cli",
  home: {
    root: "/synthetic/agents/connection",
    home: "/synthetic/agents/connection/home",
    config: "/synthetic/agents/connection/codex",
    work: "/synthetic/agents/connection/work",
  },
  workingDirectory: "/synthetic/workspace",
  environment: {},
  timeoutMs: 60_000,
  signal: new AbortController().signal,
  onLine: () => {},
};

/** A service manager that answers `show` from a table and everything else empty. */
function manager(
  states: Readonly<Record<string, string>>,
): ReturnType<typeof vi.fn<CliWorkerCommand>> {
  return vi.fn<CliWorkerCommand>(async (file, args) => {
    const property = args
      .find((arg) => arg.startsWith("--property="))
      ?.slice("--property=".length);
    return { stdout: property ? `${states[property] ?? ""}\n` : "" };
  });
}

function journalLine(unit: string, message: string): string {
  return JSON.stringify({ USER_UNIT: unit, MESSAGE_ID: message });
}

async function settledUnit(command: CliWorkerCommand): Promise<unknown> {
  const units = new CliWorkerUnits("/synthetic/units", command);
  const { unit } = await units.wrap(REQUEST, INSTANCE);
  return unit.settle();
}

beforeEach(() => {
  vi.clearAllMocks();
});

it("settles a stopped unit only after the service manager reports it inactive", async () => {
  const command = manager({
    LoadState: "loaded",
    ActiveState: "inactive",
    Result: "success",
  });

  await expect(settledUnit(command)).resolves.toBe("success");
  const calls = command.mock.calls.map(([, args]) => args.join(" "));
  expect(calls).toContainEqual(
    expect.stringMatching(/^--user stop pages-acp-/u),
  );
  expect(calls).toContainEqual(
    expect.stringContaining("--property=ActiveState"),
  );
});

it("refuses to settle a unit that still runs after its stop", async () => {
  const command = manager({ LoadState: "loaded", ActiveState: "deactivating" });

  await expect(settledUnit(command)).rejects.toThrow(
    "The worker unit did not stop",
  );
  // The failed unit is still reset, so no stale state stays behind.
  expect(
    command.mock.calls.some(([, args]) => args.includes("reset-failed")),
  ).toBe(true);
});

it("tells whether a unit of exactly this session still runs", async () => {
  const listing = (stdout: string): CliWorkerCommand =>
    vi.fn<CliWorkerCommand>(async () => ({ stdout }));

  await expect(
    hasRunningWorkerUnit(
      INSTANCE,
      listing(`${UNIT} loaded active running Pages worker\n`),
    ),
  ).resolves.toBe(true);
  await expect(
    hasRunningWorkerUnit(
      INSTANCE,
      listing(`${UNIT} loaded failed failed Pages worker\n`),
    ),
  ).resolves.toBe(false);
  await expect(
    hasRunningWorkerUnit(
      INSTANCE,
      listing("pages-acp-other-0123abcd.service loaded active running x\n"),
    ),
  ).resolves.toBe(false);
});

it("proves an end only for one journaled unit that started and then ended", async () => {
  const other = "1c7d2c2f-8e3b-4a1f-8b62-2e5f9d3f4b21";
  const twice = "2d8e3d3a-9f4c-4b2a-9c73-3f6a0e4a5c32";
  const command = vi.fn<CliWorkerCommand>(async () => ({
    stdout: [
      journalLine(UNIT, START_BEGUN),
      journalLine(UNIT, STARTED),
      journalLine(UNIT, SUCCEEDED),
      journalLine(`pages-acp-${other}-89abcdef.service`, STARTED),
      journalLine(`pages-acp-${twice}-00000001.service`, STARTED),
      journalLine(`pages-acp-${twice}-00000001.service`, STOPPED),
      journalLine(`pages-acp-${twice}-00000002.service`, STARTED),
      journalLine(`pages-acp-${twice}-00000002.service`, STOPPED),
      JSON.stringify({ MESSAGE_ID: STARTED }),
      "",
    ].join("\n"),
  }));

  const ends = await readJournaledWorkerUnitEnds(
    { since: "2026-11-12T13:00:00.000Z" },
    command,
  );

  expect(ends.get(INSTANCE)).toBe(true);
  // Started but never ended: it may still run.
  expect(ends.get(other)).toBe(false);
  // Two units for one session: the evidence is contradictory.
  expect(ends.get(twice)).toBe(false);
  const [file, args] = command.mock.calls[0] ?? [];
  expect(file).toBe("/usr/bin/journalctl");
  expect(args).toContain("--user");
  expect(args).toContain("--user-unit=pages-acp-*");
  expect(args).toContain(
    `--since=@${Date.parse("2026-11-12T13:00:00.000Z") / 1000 - 300}`,
  );
});

it("reads the journal of one session and refuses unreadable entries", async () => {
  const command = vi.fn<CliWorkerCommand>(async () => ({ stdout: "" }));
  await expect(
    readJournaledWorkerUnitEnds(
      { since: "2026-11-12T13:00:00.000Z", instanceId: INSTANCE },
      command,
    ),
  ).resolves.toEqual(new Map());
  expect(command.mock.calls[0]?.[1]).toContain(
    `--user-unit=pages-acp-${INSTANCE}-*`,
  );
  await expect(
    readJournaledWorkerUnitEnds(
      { since: "2026-11-12T13:00:00.000Z" },
      vi.fn<CliWorkerCommand>(async () => ({ stdout: "{broken\n" })),
    ),
  ).rejects.toThrow();
  await expect(
    readJournaledWorkerUnitEnds({ since: "no date" }, command),
  ).rejects.toThrow("Invalid journal start");
});
