import { randomUUID } from "node:crypto";
import { readFile, readdir, rm as removeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CliWorkerUnits } from "@/backend/agents/cli/CliWorkerUnit";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import type * as FsPromises from "node:fs/promises";
import type { Mock } from "vitest";
import type {
  CliSessionRequest,
  CliWorkerUnitResult,
} from "@/backend/agents/cli/CliContracts";
import type { CliWorkerCommand } from "@/backend/agents/cli/CliWorkerUnit";

const mocks = vi.hoisted(() => ({
  rm: vi.fn<typeof FsPromises.rm>(),
  environment: vi.fn<() => Record<string, string>>(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original: typeof FsPromises = await importOriginal();
  mocks.rm.mockImplementation(original.rm);
  return { ...original, rm: mocks.rm };
});
vi.mock("@/backend/agents/cli/CliEnvironment", () => ({
  createCliRequestEnvironment: mocks.environment,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
  logEvent: vi.fn(),
}));

const HOME = {
  root: "/r",
  home: "/r/home",
  config: "/r/config",
  work: "/r/work",
};
let directory = "";

function requestOf(
  overrides: Partial<CliSessionRequest> = {},
): CliSessionRequest {
  return {
    file: "/bin/tool",
    arguments: ["--x"],
    provider: "claude_code",
    home: HOME,
    workingDirectory: "/work",
    environment: { EXTRA: "1" },
    timeoutMs: 30_000,
    signal: new AbortController().signal,
    onLine: vi.fn(),
    ...overrides,
  };
}

interface Script {
  readonly manager?: string;
  readonly states?: Record<string, string>;
  readonly failing?: readonly string[];
}

function commandOf(script: Script = {}): Mock<CliWorkerCommand> {
  return vi.fn(async (file, args) => {
    const verb = args[1] ?? "";
    if ((script.failing ?? []).includes(verb))
      throw new Error(`${verb} failed`);
    if (verb === "show-environment") return { stdout: script.manager ?? "" };
    const property = args.find((arg) => arg.startsWith("--property="));
    const key = property?.slice("--property=".length) ?? "";
    return { stdout: `${script.states?.[key] ?? ""}\n` };
  });
}

async function wrapped(
  command: Mock<CliWorkerCommand>,
  request = requestOf(),
): ReturnType<CliWorkerUnits["wrap"]> {
  return new CliWorkerUnits(directory, command).wrap(request, "abc");
}

function propertiesOf(request: CliSessionRequest): string[] {
  return request.arguments.filter(
    (_, index) => request.arguments[index - 1] === "-p",
  );
}

beforeEach(() => {
  directory = path.join(
    os.homedir(),
    ".pages",
    "tmp",
    "worker-units",
    randomUUID(),
  );
  mocks.environment.mockReturnValue({ A: "x", B: 'q"\\$`' });
});

afterEach(async () => {
  await removeFile(directory, { recursive: true, force: true });
});

it("wraps a request into a limited unit with a private environment file", async () => {
  const command = commandOf({
    manager: "A=1\nSSH_AUTH_SOCK=/s\nbad name=1\nnoequals",
  });
  const { request, unit } = await wrapped(command);

  expect(request.file).toBe("/usr/bin/systemd-run");
  expect(request.toolFile).toBe("/bin/tool");
  expect(request.environment.EXTRA).toBe("1");
  expect(request.environment.XDG_RUNTIME_DIR).toMatch(/^\/run\/user\/\d+$/u);
  expect(request.arguments).toContain(`--unit=${unit.name}`);
  expect(request.arguments.slice(-2)).toEqual(["/bin/tool", "--x"]);
  expect(request.arguments).not.toContain("--property=KillMode=control-group");
  const properties = propertiesOf(request);
  expect(properties).toContain("RuntimeMaxSec=150");
  expect(properties).toContain("UnsetEnvironment=SSH_AUTH_SOCK noequal");
  const file = properties
    .find((property) => property.startsWith("EnvironmentFile="))
    ?.slice("EnvironmentFile=".length);
  expect(await readFile(file ?? "", "utf8")).toBe(
    'A="x"\nB="q\\"\\\\\\$\\`"\n',
  );
  expect(command).toHaveBeenCalledWith(
    "/usr/bin/systemctl",
    expect.arrayContaining(["set-property", "MemoryMax=10G"]),
  );
  unit.started();
});

it("keeps the tool file of a request and has no unset list without variables", async () => {
  const { request } = await wrapped(
    commandOf(),
    requestOf({ toolFile: "/bin/real", timeoutMs: 0 }),
  );

  expect(request.toolFile).toBe("/bin/real");
  const properties = propertiesOf(request);
  expect(properties).toContain("RuntimeMaxSec=86400");
  expect(properties.some((entry) => entry.startsWith("UnsetEnvironment"))).toBe(
    false,
  );
});

it("lets a native host worker run in its control group", async () => {
  mocks.environment.mockReturnValue({ FUNC: "line1\nline2" });
  const { request } = await wrapped(
    commandOf(),
    requestOf({ hostEnvironment: { FUNC: "x" }, workingDirectory: "/w" }),
  );

  expect(request.arguments).toContain("--working-directory=/w");
  expect(request.arguments).toContain("--property=KillMode=control-group");
});

it("leaves the runtime of a pausing codex worker to its owner", async () => {
  const { request } = await wrapped(
    commandOf(),
    requestOf({ provider: "codex_cli", pausesRuntime: true }),
  );
  expect(propertiesOf(request)).toContain("RuntimeMaxSec=infinity");

  const other = await wrapped(
    commandOf(),
    requestOf({ provider: "codex_cli" }),
  );
  expect(propertiesOf(other.request)).toContain("RuntimeMaxSec=150");
});

it("refuses values that systemd cannot hold in its environment file", async () => {
  const invalid: Record<string, string>[] = [
    { BAD: "a\nb" },
    { "1BAD": "a" },
    { NUL: "a\0b" },
  ];
  for (const environment of invalid) {
    mocks.environment.mockReturnValue(environment);
    await expect(wrapped(commandOf())).rejects.toThrow(
      "cannot be passed to a worker unit",
    );
  }
});

it("starts without the shared budget when the slice cannot be limited", async () => {
  const { request } = await wrapped(commandOf({ failing: ["set-property"] }));

  expect(request.file).toBe("/usr/bin/systemd-run");
});

it("hides a failure of the manager and removes the file", async () => {
  await expect(
    wrapped(commandOf({ failing: ["show-environment"] })),
  ).rejects.toMatchObject({ code: "acp_worker_unit_unavailable" });
  expect(await readdir(directory)).toEqual([]);

  mocks.rm.mockRejectedValueOnce(new Error("busy"));
  await expect(
    wrapped(commandOf({ failing: ["show-environment"] })),
  ).rejects.toMatchObject({ code: "credential_cleanup_failed" });
});

it("signals the unit and logs a failure", async () => {
  const command = commandOf({ failing: ["kill"] });
  const { unit } = await wrapped(command);

  unit.signal("SIGTERM");
  await vi.waitFor(() => {
    expect(logCaughtError).toHaveBeenCalledTimes(1);
  });
  expect(command).toHaveBeenCalledWith("/usr/bin/systemctl", [
    "--user",
    "kill",
    "--signal=SIGTERM",
    "--kill-whom=all",
    unit.name,
  ]);
});

it("removes the environment file once and logs a failed removal", async () => {
  const { unit } = await wrapped(commandOf());
  mocks.rm.mockClear();
  mocks.rm.mockRejectedValueOnce(new Error("busy"));

  unit.started();
  unit.started();

  await vi.waitFor(() => {
    expect(logCaughtError).toHaveBeenCalledTimes(1);
  });
  expect(mocks.rm).toHaveBeenCalledTimes(1);
});

async function settled(script: Script): Promise<{
  result: CliWorkerUnitResult | Error;
  command: Mock<CliWorkerCommand>;
}> {
  const command = commandOf(script);
  const { unit } = await wrapped(command);
  try {
    return { result: await unit.settle(), command };
  } catch (caught: unknown) {
    return { result: caught as Error, command };
  }
}

it("settles a unit that systemd unloaded as a success", async () => {
  const { result, command } = await settled({
    states: { LoadState: "not-found" },
  });

  expect(result).toBe("success");
  expect(command).not.toHaveBeenCalledWith("/usr/bin/systemctl", [
    "--user",
    "stop",
    expect.any(String),
  ]);
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({ level: "info" }),
  );
});

it("reads the recorded result of a stopped unit", async () => {
  const levels: Record<string, string> = {};
  for (const recorded of ["exit-code", "oom-kill", "weird"]) {
    const { result } = await settled({
      states: {
        LoadState: "loaded",
        ActiveState: "failed",
        Result: ` ${recorded}`,
      },
    });
    levels[recorded] = String(result);
  }

  expect(levels).toEqual({
    "exit-code": "exit-code",
    "oom-kill": "oom-kill",
    weird: "unknown",
  });
  const levelsLogged = vi
    .mocked(logEvent)
    .mock.calls.map(([event]) => event.level);
  expect(levelsLogged).toEqual(["info", "warn", "warn"]);
});

it("fails the settlement of a unit that does not stop and still resets it", async () => {
  const { result, command } = await settled({
    states: { LoadState: "loaded", ActiveState: "active" },
  });

  expect(result).toEqual(new Error("The worker unit did not stop"));
  expect(command).toHaveBeenCalledWith("/usr/bin/systemctl", [
    "--user",
    "reset-failed",
    expect.any(String),
  ]);
});

it("logs a failed reset after the settlement", async () => {
  const { result } = await settled({
    states: { LoadState: "not-found" },
    failing: ["reset-failed"],
  });

  expect(result).toBe("success");
  expect(logCaughtError).toHaveBeenCalledTimes(1);
});

it("probes once at a time and keeps a positive answer", async () => {
  const command = commandOf();
  const units = new CliWorkerUnits(directory, command);

  const first = units.isAvailable();
  const second = units.isAvailable();
  expect(await Promise.all([first, second])).toEqual([true, true]);
  expect(await units.isAvailable()).toBe(true);
  expect(command).toHaveBeenCalledTimes(1);
});

it("repeats a failed probe after a minute and keeps the answer before", async () => {
  vi.useFakeTimers();
  try {
    const command = commandOf();
    command.mockRejectedValueOnce(new Error("no manager"));
    const units = new CliWorkerUnits(directory, command);

    expect(await units.isAvailable()).toBe(false);
    expect(await units.isAvailable()).toBe(false);
    expect(command).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(await units.isAvailable()).toBe(true);
    expect(command).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it("builds units with the default command", () => {
  expect(new CliWorkerUnits(directory)).toBeInstanceOf(CliWorkerUnits);
});

it("falls back to the root runtime directory without a user id", async () => {
  const original = Object.getOwnPropertyDescriptor(process, "getuid");
  Object.defineProperty(process, "getuid", {
    value: undefined,
    configurable: true,
  });
  try {
    const { request } = await wrapped(commandOf());

    expect(request.environment.XDG_RUNTIME_DIR).toBe("/run/user/0");
  } finally {
    if (original) Object.defineProperty(process, "getuid", original);
  }
});
