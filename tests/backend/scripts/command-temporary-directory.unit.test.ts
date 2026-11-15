import { beforeEach, expect, it, vi } from "vitest";

import { withCommandTemporaryDirectory } from "@/scripts/command-temporary-directory.mjs";

const filesystem = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  mkdtemp: vi.fn(async (prefix: string) => `${prefix}private`),
  rm: vi.fn(async () => undefined),
}));
vi.mock("node:fs/promises", () => filesystem);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TMPDIR", "/disk/run/step");
  vi.stubEnv("TEMP", "/previous");
  vi.stubEnv("TMP", "/previous");
  vi.stubEnv("NODE_COMPILE_CACHE", "/previous-cache");
});

it("keeps every child scratch/cache variable below TMPDIR and removes only its own directory", async () => {
  await expect(
    withCommandTemporaryDirectory(async ({ directory }) => {
      expect(directory).toBe("/disk/run/step/pages-command-private");
      expect(process.env.TMPDIR).toBe(directory);
      expect(process.env.TEMP).toBe(directory);
      expect(process.env.TMP).toBe(directory);
      expect(process.env.NODE_COMPILE_CACHE).toBe(
        `${directory}/node-compile-cache`,
      );
      return 7;
    }),
  ).resolves.toBe(7);
  expect(filesystem.rm).toHaveBeenCalledExactlyOnceWith(
    "/disk/run/step/pages-command-private",
    { recursive: true, force: true },
  );
  expect(process.env.TMPDIR).toBe("/disk/run/step");
  expect(process.env.TEMP).toBe("/previous");
});

it("also removes scratch when setup or checks fail", async () => {
  await expect(
    withCommandTemporaryDirectory(async () => {
      throw new Error("check failed");
    }),
  ).rejects.toThrow("check failed");
  expect(filesystem.rm).toHaveBeenCalledTimes(1);
});

it.each(["SIGINT", "SIGTERM"] as const)(
  "aborts on %s and waits for child shutdown before deleting scratch",
  async (signalName) => {
    const previousExitCode = process.exitCode;
    try {
      await withCommandTemporaryDirectory(async ({ signal }) => {
        process.emit(signalName);
        expect(signal.aborted).toBe(true);
        expect(filesystem.rm).not.toHaveBeenCalled();
        await Promise.resolve();
      });
      expect(filesystem.rm).toHaveBeenCalledTimes(1);
      expect(process.exitCode).toBe(signalName === "SIGTERM" ? 143 : 130);
    } finally {
      process.exitCode = previousExitCode;
    }
  },
);

it("retains scratch when child shutdown cannot be confirmed", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(
    withCommandTemporaryDirectory(async () => {
      throw Object.assign(new Error("processes remain"), {
        retainTemporaryDirectory: true,
      });
    }),
  ).rejects.toThrow("processes remain");
  expect(filesystem.rm).not.toHaveBeenCalled();
});
