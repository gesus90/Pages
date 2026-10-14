import { ChildProcess, spawn } from "node:child_process";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { openPairingBrowser } from "../../src/pairing-browser.ts";

import type * as ChildProcessModule from "node:child_process";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcessModule>()),
  spawn: vi.fn(),
}));

const LINK = new URL("https://pages.example/pair?code=BCDF-GHJK");
const DESKTOP = { DISPLAY: ":0" };
const INTERACTIVE = { noBrowser: false, isTerminal: true };

/** Lets the fake opener report its outcome after the caller attached listeners. */
function emitLater(
  eventName: "error" | "exit",
  eventArgument: Error | number,
): void {
  vi.mocked(spawn).mockImplementation(() => {
    const opener = new ChildProcess();
    queueMicrotask(() => opener.emit(eventName, eventArgument));
    return opener;
  });
}

beforeEach(() => {
  vi.mocked(spawn).mockReset();
  emitLater("exit", 0);
});

describe("openPairingBrowser guards", () => {
  it.each([
    {
      reason: "--no-browser was given",
      environment: DESKTOP,
      options: { ...INTERACTIVE, noBrowser: true, platform: "linux" as const },
    },
    {
      reason: "stderr is not a terminal",
      environment: DESKTOP,
      options: {
        ...INTERACTIVE,
        isTerminal: false,
        platform: "linux" as const,
      },
    },
    {
      reason: "an SSH connection is active",
      environment: { ...DESKTOP, SSH_CONNECTION: "10.0.0.2 5000 10.0.0.1 22" },
      options: { ...INTERACTIVE, platform: "darwin" as const },
    },
    {
      reason: "an SSH terminal is active",
      environment: { ...DESKTOP, SSH_TTY: "/dev/pts/1" },
      options: { ...INTERACTIVE, platform: "win32" as const },
    },
    {
      reason: "Linux has neither DISPLAY nor WAYLAND_DISPLAY",
      environment: {},
      options: { ...INTERACTIVE, platform: "linux" as const },
    },
    {
      reason: "the platform has no supported opener",
      environment: DESKTOP,
      options: { ...INTERACTIVE, platform: "freebsd" as const },
    },
  ])("returns false without spawning when $reason", async (scenario) => {
    await expect(
      openPairingBrowser(LINK, scenario.environment, scenario.options),
    ).resolves.toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("openPairingBrowser openers", () => {
  it.each([
    { platform: "linux" as const, environment: DESKTOP, command: "xdg-open" },
    {
      platform: "linux" as const,
      environment: { WAYLAND_DISPLAY: "wayland-0" },
      command: "xdg-open",
    },
    { platform: "darwin" as const, environment: {}, command: "open" },
    { platform: "win32" as const, environment: {}, command: "explorer.exe" },
  ])(
    "runs $command on $platform without a shell",
    async ({ platform, environment, command }) => {
      await expect(
        openPairingBrowser(LINK, environment, { ...INTERACTIVE, platform }),
      ).resolves.toBe(true);
      expect(spawn).toHaveBeenCalledExactlyOnceWith(command, [LINK.href], {
        shell: false,
        stdio: "ignore",
      });
    },
  );

  it("reports failure when the opener exits with a non-zero code", async () => {
    emitLater("exit", 3);

    await expect(
      openPairingBrowser(LINK, DESKTOP, { ...INTERACTIVE, platform: "linux" }),
    ).resolves.toBe(false);
  });

  it("reports failure when the opener cannot be started", async () => {
    emitLater("error", new Error("spawn xdg-open ENOENT"));

    await expect(
      openPairingBrowser(LINK, DESKTOP, { ...INTERACTIVE, platform: "linux" }),
    ).resolves.toBe(false);
  });

  it("uses the running platform when none is given", async () => {
    const implicit = await openPairingBrowser(LINK, DESKTOP, INTERACTIVE);
    const explicit = await openPairingBrowser(LINK, DESKTOP, {
      ...INTERACTIVE,
      platform: process.platform,
    });

    expect(implicit).toBe(explicit);
    expect(vi.mocked(spawn).mock.calls[0]).toEqual(
      vi.mocked(spawn).mock.calls[1],
    );
  });
});
