import { beforeEach, expect, it, vi } from "vitest";

import {
  hasInactiveRecordedUnit,
  hasRunningWorkerUnit,
  listRunningWorkerUnits,
  probeWorkerUnits,
  settleRecordedWorkerUnit,
  settleWorkerUnits,
  stopWorkerUnits,
} from "@/backend/agents/cli/CliWorkerUnit";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Mock } from "vitest";
import type { CliWorkerCommand } from "@/backend/agents/cli/CliWorkerUnit";

type ExecFileCall = [
  string,
  string[],
  { timeout: number; env: Record<string, string> },
  (error: Error | null, result?: { stdout: string }) => void,
];

const process = vi.hoisted(() => ({
  execFile: vi.fn<(...call: ExecFileCall) => void>(),
}));

vi.mock("node:child_process", () => process);
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
  logEvent: vi.fn(),
}));

const UNIT = "pages-acp-abc-0123abcd.service";

function commandOf(
  answer: (args: readonly string[]) => string | Error,
): Mock<CliWorkerCommand> {
  return vi.fn(async (file, args) => {
    const response = answer(args);
    if (response instanceof Error) throw response;
    return { stdout: response };
  });
}

function failure(properties: Record<string, unknown>): Error {
  return Object.assign(new Error("failed"), properties);
}

beforeEach(() => {
  process.execFile.mockImplementation((...call: ExecFileCall) => {
    call[3](null, { stdout: "" });
  });
});

it("runs the real command with the manager environment by default", async () => {
  await stopWorkerUnits("abc");
  expect(await probeWorkerUnits()).toBe(true);

  const [file, args, options] = process.execFile.mock.calls[0] ?? [];
  expect(file).toBe("/usr/bin/systemctl");
  expect(args).toContain("--user");
  expect(options.timeout).toBe(10_000);
  expect(options.env.PATH).toBe("/usr/bin:/bin");
  expect(options.env.DBUS_SESSION_BUS_ADDRESS).toBe(
    `unix:path=${options.env.XDG_RUNTIME_DIR}/bus`,
  );
});

it("recognizes a recorded unit that is gone or inactive", async () => {
  const answers = [
    "LoadState=not-found\nActiveState=inactive",
    "LoadState=loaded\nActiveState=failed",
    "LoadState=loaded\nActiveState=active",
  ];
  const results: boolean[] = [];
  for (const answer of answers)
    results.push(
      await hasInactiveRecordedUnit(
        UNIT,
        commandOf(() => answer),
      ),
    );

  expect(results).toEqual([true, true, false]);
});

it("rejects an unsafe recorded unit name without asking the manager", async () => {
  const command = commandOf(() => "");

  expect(await hasInactiveRecordedUnit("bad name.service", command)).toBe(
    false,
  );
  expect(command).not.toHaveBeenCalled();
});

it("accepts the exit status of a unit that is not found", async () => {
  const command = commandOf(() =>
    failure({ code: 1, stdout: "LoadState=not-found\n" }),
  );

  expect(await hasInactiveRecordedUnit(UNIT, command)).toBe(true);
});

it("rethrows a manager failure that proves nothing", async () => {
  const failures: unknown[] = [
    null,
    "text",
    failure({}),
    failure({ code: 2, stdout: "LoadState=not-found" }),
    failure({ code: 1 }),
    failure({ code: 1, stdout: 5 }),
    failure({ code: 1, stdout: "LoadState=loaded" }),
  ];
  for (const caught of failures)
    await expect(
      hasInactiveRecordedUnit(
        UNIT,
        vi.fn(async () => {
          throw caught;
        }),
      ),
    ).rejects.toBe(caught);
});

it("stops the units of a session and tolerates a failed reset", async () => {
  const command = commandOf((args) => {
    if (args.includes("list-units"))
      return `${UNIT} loaded\n\n  \npages-acp-abd-0123abcd.service x\npages-acp-abc-ffffffff.service y`;
    if (args.includes("reset-failed") && args.includes(UNIT))
      return failure({ code: 5 });
    return "";
  });

  expect(await stopWorkerUnits("abc", command)).toBe(2);
  expect(command).toHaveBeenCalledWith("/usr/bin/systemctl", [
    "--user",
    "stop",
    UNIT,
  ]);
  expect(logCaughtError).toHaveBeenCalledTimes(1);
});

it("stops nothing for an unsafe session tag", async () => {
  const command = commandOf(() => "");

  expect(await stopWorkerUnits("a b", command)).toBe(0);
  expect(command).not.toHaveBeenCalled();
});

const LISTING = [
  `${UNIT} loaded active running x`,
  "pages-acp-abc-11111111.service loaded activating start x",
  "pages-acp-abc-22222222.service loaded inactive dead x",
  "pages-acp-abc-33333333.service loaded failed failed x",
  "other.service loaded active running x",
  "",
  "pages-acp-xyz-44444444.service loaded deactivating stop x",
  "pages-acp-xyz-55555555.service loaded",
].join("\n");

it("lists the units that still run", async () => {
  const running = await listRunningWorkerUnits(commandOf(() => LISTING));

  expect([...running].sort()).toEqual([
    UNIT,
    "pages-acp-abc-11111111.service",
    "pages-acp-xyz-44444444.service",
  ]);
});

it("tells whether a session still has a running unit", async () => {
  const command = commandOf(() => LISTING);

  expect(await hasRunningWorkerUnit("abc", command)).toBe(true);
  expect(await hasRunningWorkerUnit("nobody", command)).toBe(false);
});

it("counts the units of a session that still run after the stop", async () => {
  const command = commandOf((args) => {
    if (args.at(-1) === "pages-acp-abc-*") return `${UNIT} loaded\n`;
    return args.includes("list-units") ? LISTING : "";
  });

  expect(await settleWorkerUnits("abc", command)).toBe(2);
});

it("rejects a recorded unit with a foreign identity", async () => {
  const command = commandOf(() => "");
  for (const [instanceId, name] of [
    ["a b", UNIT],
    ["abc", "pages-acp-xyz-0123abcd.service"],
    ["abc", "pages-acp-abc-0123ABCD.service"],
  ] as const)
    await expect(
      settleRecordedWorkerUnit(instanceId, name, command),
    ).rejects.toThrow("Invalid worker unit identity");
  expect(command).not.toHaveBeenCalled();
});

it("stops a loaded recorded unit and confirms that it is gone", async () => {
  const states = ["loaded", "", "inactive"];
  const command = commandOf(() => states.shift() ?? "");

  expect(await settleRecordedWorkerUnit("abc", UNIT, command)).toBe(0);
  expect(command).toHaveBeenCalledTimes(3);
});

it("does not stop an unloaded recorded unit and reports one that runs", async () => {
  const states = ["not-found\n", "failed"];
  const unloaded = commandOf(() => states.shift() ?? "");
  expect(await settleRecordedWorkerUnit("abc", UNIT, unloaded)).toBe(0);
  expect(unloaded).toHaveBeenCalledTimes(2);

  const running = commandOf((args) =>
    args.includes("--property=LoadState") ? "not-found" : "active",
  );
  expect(await settleRecordedWorkerUnit("abc", UNIT, running)).toBe(1);
});

it("reports a probe that fails", async () => {
  const command = commandOf(() => failure({ code: 1 }));

  expect(await probeWorkerUnits(command)).toBe(false);
  expect(logCaughtError).toHaveBeenCalledTimes(1);
});

it("ignores a listing line that yields no word", async () => {
  const emptyLine = { trim: () => ({ split: () => [] }) };
  const command = vi.fn(async () => ({
    stdout: { split: () => [emptyLine] } as unknown as string,
  }));

  expect(await stopWorkerUnits("abc", command)).toBe(0);
});
