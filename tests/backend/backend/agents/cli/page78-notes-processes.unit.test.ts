import { beforeEach, expect, it, vi } from "vitest";

import { areTaggedProcessesGone } from "@/backend/agents/cli/CliNotesProcessScan";

const filesystem = vi.hoisted(() => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}));
vi.mock("node:fs/promises", () => filesystem);

beforeEach(() => {
  filesystem.readdir.mockResolvedValue(["9876543"]);
  filesystem.stat.mockResolvedValue({ uid: process.getuid?.() });
  filesystem.readFile.mockResolvedValue("PAGES_RUN_INSTANCE=other\0");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

it("confirms absence only after a readable process scan", async () => {
  expect(await areTaggedProcessesGone(["run-session"])).toBe(true);
  filesystem.readFile.mockResolvedValue("PAGES_RUN_INSTANCE=run-session\0");
  expect(await areTaggedProcessesGone(["run-session"])).toBe(false);
});

it("retains unknown states on unreadable own environments or unavailable proc", async () => {
  filesystem.readFile.mockRejectedValue(
    Object.assign(new Error("denied"), { code: "EACCES" }),
  );
  expect(await areTaggedProcessesGone(["run-session"])).toBe(false);
  filesystem.readdir.mockRejectedValue(new Error("proc unavailable"));
  expect(await areTaggedProcessesGone(["run-session"])).toBe(false);
  expect(console.error).toHaveBeenCalled();
});

it("accepts a process that vanished during scanning and ignores other accounts", async () => {
  filesystem.readFile.mockRejectedValue(
    Object.assign(new Error("exited"), { code: "ENOENT" }),
  );
  expect(await areTaggedProcessesGone(["run-session"])).toBe(true);
  filesystem.stat.mockResolvedValue({ uid: (process.getuid?.() ?? 0) + 1 });
  expect(await areTaggedProcessesGone(["run-session"])).toBe(true);
});
