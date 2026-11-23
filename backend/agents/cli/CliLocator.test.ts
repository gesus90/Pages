import { constants } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CLI_BINARIES, CliLocator } from "@/backend/agents/cli/CliLocator";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  stat: vi.fn(),
  logCaughtError: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  access: mocks.access,
  stat: mocks.stat,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
}));

afterEach(() => {
  mocks.access.mockReset();
  mocks.stat.mockReset();
  mocks.logCaughtError.mockReset();
});

function installed(...files: readonly string[]): void {
  mocks.access.mockImplementation(async (candidate: string) => {
    if (!files.includes(candidate)) throw new Error("ENOENT");
  });
  mocks.stat.mockResolvedValue({ isFile: () => true });
}

describe("CliLocator.locate", () => {
  it("prefers a managed installation and skips the filesystem", async () => {
    const managed = vi
      .fn()
      .mockResolvedValue({ found: true, path: "/managed/codex" });
    const locator = new CliLocator("/usr/bin", "/node/bin/node", managed);

    await expect(locator.locate("codex")).resolves.toEqual({
      found: true,
      path: "/managed/codex",
    });
    expect(managed).toHaveBeenCalledWith("codex");
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it("falls back to the search path when the managed lookup finds nothing", async () => {
    const managed = vi.fn().mockResolvedValue({ found: false, path: null });
    installed("/usr/bin/codex");
    const locator = new CliLocator("/usr/bin", "/node/bin/node", managed);

    await expect(locator.locate("codex")).resolves.toEqual({
      found: true,
      path: "/usr/bin/codex",
    });
    expect(mocks.access).toHaveBeenCalledWith("/usr/bin/codex", constants.X_OK);
  });

  it("ignores relative entries and finds the binary next to Node", async () => {
    installed("/node/bin/codex");
    const locator = new CliLocator("relative:/usr/bin", "/node/bin/node");

    await expect(locator.locate("codex")).resolves.toEqual({
      found: true,
      path: "/node/bin/codex",
    });
    expect(mocks.access).not.toHaveBeenCalledWith(
      "relative/codex",
      expect.anything(),
    );
    expect(mocks.logCaughtError).toHaveBeenCalledWith(
      "CliLocator",
      expect.any(Error),
    );
  });

  it("checks a directory only once and rejects non-files", async () => {
    mocks.access.mockResolvedValue(undefined);
    mocks.stat.mockResolvedValue({ isFile: () => false });
    const locator = new CliLocator("/node/bin", "/node/bin/node");

    await expect(locator.locate("codex")).resolves.toEqual({
      found: false,
      path: null,
    });
    expect(mocks.access).toHaveBeenCalledTimes(1);
  });

  it("uses the process PATH and Node binary by default", async () => {
    mocks.access.mockRejectedValue(new Error("ENOENT"));
    vi.stubEnv("PATH", "");
    const locator = new CliLocator();

    await expect(locator.locate("codex")).resolves.toEqual({
      found: false,
      path: null,
    });
    expect(mocks.access).toHaveBeenCalledTimes(1);
  });

  it("treats a missing PATH as empty", async () => {
    mocks.access.mockRejectedValue(new Error("ENOENT"));
    vi.stubEnv("PATH", undefined);
    const locator = new CliLocator();

    await expect(locator.find("opencode")).resolves.toEqual({
      found: false,
      path: null,
    });
  });
});

describe("CliLocator.find and list", () => {
  it("maps every provider to its own binary", async () => {
    installed("/bin/codex", "/bin/claude", "/bin/opencode", "/bin/agy");
    const locator = new CliLocator("/bin", "/node/bin/node");

    await expect(locator.list()).resolves.toEqual({
      codex_cli: { found: true, path: "/bin/codex" },
      claude_code: { found: true, path: "/bin/claude" },
      opencode: { found: true, path: "/bin/opencode" },
      antigravity: { found: true, path: "/bin/agy" },
    });
    expect(CLI_BINARIES.antigravity).toBe("agy");
  });
});
