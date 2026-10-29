import { afterEach, expect, it, vi } from "vitest";

import { CliLocator } from "@/backend/agents/cli/CliLocator";

const files = vi.hoisted(() => ({
  executable: new Map<string, boolean>(),
  access: vi.fn(async (path: string) => {
    if (!files.executable.has(path)) throw new Error(`EACCES ${path}`);
  }),
  stat: vi.fn(async (path: string) => ({
    isFile: () => files.executable.get(path) === true,
  })),
}));
const logging = vi.hoisted(() => ({ logCaughtError: vi.fn() }));

vi.mock("node:fs/promises", () => ({ access: files.access, stat: files.stat }));
vi.mock("@/backend/logging/Logger", () => logging);

afterEach(() => {
  files.executable.clear();
  files.access.mockClear();
  logging.logCaughtError.mockReset();
  vi.unstubAllEnvs();
});

it("finds a CLI in the first absolute PATH directory that holds an executable file", async () => {
  files.executable.set("/first/codex", false);
  files.executable.set("/second/codex", true);
  const locator = new CliLocator("relative:/first:/second", "/node/bin/node");

  await expect(locator.find("codex_cli")).resolves.toEqual({
    found: true,
    path: "/second/codex",
  });
  expect(files.access.mock.calls.map(([path]) => path)).toEqual([
    "/first/codex",
    "/second/codex",
  ]);
});

it("falls back to the directory of the running Node binary", async () => {
  files.executable.set("/node/bin/claude", true);
  const locator = new CliLocator("/missing", "/node/bin/node");

  await expect(locator.find("claude_code")).resolves.toEqual({
    found: true,
    path: "/node/bin/claude",
  });
  expect(logging.logCaughtError).toHaveBeenCalledWith(
    "CliLocator",
    expect.any(Error),
  );
});

it("reports a CLI that is nowhere to be found", async () => {
  await expect(
    new CliLocator("/missing", "/node/bin/node").find("opencode"),
  ).resolves.toEqual({ found: false, path: null });
});

it("prefers a managed installation that has a path", async () => {
  const managed = vi.fn(async () => ({
    found: true,
    path: "/managed/codex-acp",
  }));
  const locator = new CliLocator("/missing", "/node/bin/node", managed);

  await expect(locator.locate("codex-acp")).resolves.toEqual({
    found: true,
    path: "/managed/codex-acp",
  });
  expect(files.access).not.toHaveBeenCalled();
});

it("searches the PATH when the managed installation has none", async () => {
  files.executable.set("/usr/bin/codex-acp", true);
  const managed = vi.fn(async () => ({ found: false, path: null }));
  const locator = new CliLocator("/usr/bin", "/node/bin/node", managed);

  await expect(locator.locate("codex-acp")).resolves.toEqual({
    found: true,
    path: "/usr/bin/codex-acp",
  });
});

it("lists every CLI with the process PATH by default", async () => {
  vi.stubEnv("PATH", "/env/bin");
  files.executable.set("/env/bin/codex", true);
  files.executable.set("/env/bin/opencode", true);

  await expect(new CliLocator().list()).resolves.toEqual({
    codex_cli: { found: true, path: "/env/bin/codex" },
    claude_code: { found: false, path: null },
    opencode: { found: true, path: "/env/bin/opencode" },
    antigravity: { found: false, path: null },
  });
});

it("searches only next to Node without a PATH", async () => {
  vi.stubEnv("PATH", undefined);
  const locator = new CliLocator(undefined, "/node/bin/node");

  await locator.find("codex_cli");

  expect(files.access.mock.calls.map(([path]) => path)).toEqual([
    "/node/bin/codex",
  ]);
});
