import { afterEach, expect, it, vi } from "vitest";

import { requireManagedOpenCodeConfiguration } from "@/backend/agents/acp/OpenCodeAcpConfiguration";

/** The part of a file status the guard reads. */
interface FakeStatus {
  readonly isDirectory: () => boolean;
  readonly isSymbolicLink: () => boolean;
}

const files = vi.hoisted(() => ({
  lstat: vi.fn<(path: string) => Promise<FakeStatus>>(),
}));
const logging = vi.hoisted(() => ({ logCaughtError: vi.fn() }));

vi.mock("node:fs/promises", () => files);
vi.mock("@/backend/logging/Logger", () => logging);

const HOME = {
  root: "/runner",
  home: "/runner/home",
  config: "/runner/config",
  work: "/runner/work",
};

const CONFIG = "/runner/home/config/opencode";

afterEach(() => {
  files.lstat.mockReset();
  logging.logCaughtError.mockReset();
});

function missing(): Error {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

function status(isDirectory: boolean, isSymbolicLink = false): FakeStatus {
  return {
    isDirectory: () => isDirectory,
    isSymbolicLink: () => isSymbolicLink,
  };
}

/** Lets the given paths exist with a status; every other path is missing. */
function existing(entries: Readonly<Record<string, FakeStatus | Error>>): void {
  files.lstat.mockImplementation(async (path) => {
    const entry = entries[path];
    if (entry === undefined) throw missing();
    if (entry instanceof Error) throw entry;
    return entry;
  });
}

it("accepts a runner home without any unmanaged configuration", async () => {
  existing({});

  await expect(
    requireManagedOpenCodeConfiguration(HOME),
  ).resolves.toBeUndefined();

  expect(files.lstat.mock.calls.map(([path]) => path)).toEqual([
    CONFIG,
    ...[
      "config.json",
      "config",
      "opencode.json",
      "opencode.jsonc",
      "AGENTS.md",
      "agent",
      "agents",
      "command",
      "commands",
      "plugin",
      "plugins",
      "skills",
    ].map((name) => `${CONFIG}/${name}`),
    "/runner/home/.opencode",
    "/etc/opencode/opencode.json",
    "/etc/opencode/opencode.jsonc",
  ]);
});

it("accepts an empty managed configuration folder", async () => {
  existing({ [CONFIG]: status(true) });

  await expect(
    requireManagedOpenCodeConfiguration(HOME),
  ).resolves.toBeUndefined();
});

it.each([
  ["a file", status(false)],
  ["a link", status(true, true)],
])("refuses a configuration folder that is %s", async (_, entry) => {
  existing({ [CONFIG]: entry });

  await expect(requireManagedOpenCodeConfiguration(HOME)).rejects.toMatchObject(
    {
      code: "opencode_configuration_unmanaged",
    },
  );
});

it("refuses a configuration folder it cannot inspect", async () => {
  const denied = Object.assign(new Error("denied"), { code: "EACCES" });
  existing({ [CONFIG]: denied });

  await expect(requireManagedOpenCodeConfiguration(HOME)).rejects.toMatchObject(
    {
      code: "opencode_configuration_unmanaged",
    },
  );
  expect(logging.logCaughtError).toHaveBeenCalledWith(
    "OpenCodeAcpConfiguration",
    denied,
  );
});

it("refuses a configuration folder whose failure is no file error", async () => {
  files.lstat.mockRejectedValueOnce("broken");

  await expect(requireManagedOpenCodeConfiguration(HOME)).rejects.toMatchObject(
    {
      code: "opencode_configuration_unmanaged",
    },
  );
  expect(logging.logCaughtError).toHaveBeenCalledWith(
    "OpenCodeAcpConfiguration",
    "broken",
  );
});

it("refuses any instruction source the runner could read", async () => {
  existing({ "/etc/opencode/opencode.jsonc": status(false) });

  await expect(requireManagedOpenCodeConfiguration(HOME)).rejects.toMatchObject(
    {
      code: "opencode_configuration_unmanaged",
    },
  );
  expect(logging.logCaughtError).not.toHaveBeenCalled();
});

it.each([
  ["a file error", new Error("no code")],
  ["no error object", "broken"],
])("refuses an instruction source that fails with %s", async (_, failure) => {
  files.lstat.mockImplementation(async (path) => {
    if (path === `${CONFIG}/AGENTS.md`) throw failure;
    throw missing();
  });

  await expect(requireManagedOpenCodeConfiguration(HOME)).rejects.toMatchObject(
    {
      code: "opencode_configuration_unmanaged",
    },
  );
  expect(logging.logCaughtError).toHaveBeenCalledWith(
    "OpenCodeAcpConfiguration",
    failure,
  );
});
