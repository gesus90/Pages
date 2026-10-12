import { EventEmitter } from "node:events";

import { expect, it, vi } from "vitest";

import { openPairingBrowser } from "../../mcp/src/pairing-browser";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));

it.each([
  ["linux", "xdg-open"],
  ["darwin", "open"],
  ["win32", "explorer.exe"],
] as const)(
  "opens through the %s desktop without starting a real process",
  async (platform, command) => {
    const child = new EventEmitter();
    spawn.mockReturnValue(child);
    const link = new URL("https://pages.invalid/pair?code=BCDF-GHJK");
    const opened = openPairingBrowser(
      link,
      { DISPLAY: ":0" },
      { platform, isTerminal: true, noBrowser: false },
    );
    expect(spawn).toHaveBeenCalledWith(
      command,
      [link.href],
      expect.objectContaining({ stdio: "ignore", shell: false }),
    );
    child.emit("exit", 0);
    await expect(opened).resolves.toBe(true);
  },
);

it.each(["error", "exit"])(
  "reports desktop opener failure %s",
  async (event) => {
    const child = new EventEmitter();
    spawn.mockReturnValue(child);
    const opened = openPairingBrowser(
      new URL("https://pages.invalid/pair"),
      { DISPLAY: ":0" },
      { isTerminal: true, noBrowser: false },
    );
    child.emit(
      event,
      event === "exit" ? 1 : new Error("Missing desktop opener"),
    );
    await expect(opened).resolves.toBe(false);
  },
);

it("does not launch a command for an unsupported operating system", async () => {
  await expect(
    openPairingBrowser(
      new URL("https://pages.invalid/pair"),
      { DISPLAY: ":0" },
      { platform: "aix", isTerminal: true, noBrowser: false },
    ),
  ).resolves.toBe(false);
  expect(spawn).not.toHaveBeenCalled();
});
