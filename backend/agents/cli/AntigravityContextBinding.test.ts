import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import {
  antigravityContextBinding,
  boundAntigravityHome,
  requireBoundAntigravityHome,
} from "@/backend/agents/cli/AntigravityContextBinding";

import type { Stats } from "node:fs";

const files = vi.hoisted(() => ({ lstat: vi.fn() }));

vi.mock("node:fs/promises", () => files);

const CONNECTION = "0a1b2c3d-4e5f-6789-abcd-ef0123456789";
const USER = 1000;
const ROOT = "/srv/context";

function environment(
  connectionId: string | undefined,
  root: string | undefined,
): NodeJS.ProcessEnv {
  return {
    PAGES_ANTIGRAVITY_CONNECTION_ID: connectionId,
    PAGES_ANTIGRAVITY_CONTEXT_ROOT: root,
  };
}

function metadata(overrides: Partial<Record<string, unknown>> = {}): Stats {
  return {
    isDirectory: () => true,
    isSymbolicLink: () => false,
    uid: USER,
    mode: 0o700,
    ...overrides,
  } as unknown as Stats;
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("returns null when nothing is configured", () => {
  expect(antigravityContextBinding({})).toBeNull();
});

it("returns the binding of a complete configuration", () => {
  expect(antigravityContextBinding(environment(CONNECTION, ROOT))).toEqual({
    connectionId: CONNECTION,
    root: ROOT,
  });
});

it.each([
  ["a missing id", undefined, ROOT],
  ["a missing root", CONNECTION, undefined],
  ["an empty id", "", ROOT],
  ["a malformed id", "not-a-uuid", ROOT],
  ["an empty root", CONNECTION, ""],
  ["a relative root", CONNECTION, "relative/context"],
  ["a root with a trailing separator", CONNECTION, `${ROOT}/`],
  ["a non-normalized root", CONNECTION, "/srv/../context"],
  ["the filesystem root", CONNECTION, "/"],
])("fails closed for %s", (label, connectionId, root) => {
  expect(() =>
    antigravityContextBinding(environment(connectionId, root)),
  ).toThrow(
    expect.objectContaining({ code: "antigravity_configuration_unmanaged" }),
  );
});

it("maps every location below the bound root", () => {
  expect(
    boundAntigravityHome({ connectionId: CONNECTION, root: ROOT }),
  ).toEqual({
    root: ROOT,
    home: path.join(ROOT, "home"),
    config: path.join(ROOT, "gemini"),
    work: path.join(ROOT, "work"),
    xdgConfig: path.join(ROOT, "config"),
    xdgCache: path.join(ROOT, "work"),
  });
});

const home = boundAntigravityHome({ connectionId: CONNECTION, root: ROOT });

function ancestorsThenChildren(
  ancestor: (directory: string) => Stats,
  child: (directory: string) => Stats,
): void {
  files.lstat.mockImplementation((directory: string) =>
    Promise.resolve(
      directory === ROOT || directory.startsWith(`${ROOT}/`)
        ? child(directory)
        : ancestor(directory),
    ),
  );
}

it("accepts an owned, private context", async () => {
  vi.spyOn(process, "getuid").mockReturnValue(USER);
  files.lstat.mockResolvedValue(metadata());

  await expect(requireBoundAntigravityHome(home)).resolves.toBeUndefined();
});

it("accepts an ancestor owned by root", async () => {
  vi.spyOn(process, "getuid").mockReturnValue(USER);
  ancestorsThenChildren(
    () => metadata({ uid: 0, mode: 0o755 }),
    () => metadata(),
  );

  await expect(requireBoundAntigravityHome(home)).resolves.toBeUndefined();
});

it("refuses a platform without user ids", async () => {
  vi.spyOn(process, "getuid").mockReturnValue(undefined as never);

  await expect(requireBoundAntigravityHome(home)).rejects.toMatchObject({
    code: "antigravity_configuration_unmanaged",
  });
});

it.each([
  ["not a directory", { isDirectory: () => false }],
  ["a symbolic link", { isSymbolicLink: () => true }],
  ["owned by another user", { uid: 2000, mode: 0o755 }],
  ["writable by the group", { mode: 0o775 }],
])("refuses an ancestor that is %s", async (label, overrides) => {
  vi.spyOn(process, "getuid").mockReturnValue(USER);
  files.lstat.mockResolvedValue(metadata(overrides));

  await expect(requireBoundAntigravityHome(home)).rejects.toMatchObject({
    code: "antigravity_configuration_unmanaged",
  });
});

it.each([
  ["not a directory", { isDirectory: () => false }],
  ["a symbolic link", { isSymbolicLink: () => true }],
  ["owned by root", { uid: 0 }],
  ["readable by the group", { mode: 0o750 }],
])("refuses a context location that is %s", async (label, overrides) => {
  vi.spyOn(process, "getuid").mockReturnValue(USER);
  ancestorsThenChildren(
    () => metadata(),
    () => metadata(overrides),
  );

  await expect(requireBoundAntigravityHome(home)).rejects.toMatchObject({
    code: "antigravity_configuration_unmanaged",
  });
});

it("refuses a context without a configured location", async () => {
  vi.spyOn(process, "getuid").mockReturnValue(USER);
  files.lstat.mockResolvedValue(metadata());

  await expect(
    requireBoundAntigravityHome({ ...home, xdgConfig: undefined }),
  ).rejects.toMatchObject({ code: "antigravity_configuration_unmanaged" });
});
