import { beforeEach, describe, expect, it, vi } from "vitest";

import { openDailyLog, prepareLogDirectory } from "@/backend/logging/LogFiles";

const fs = vi.hoisted(() => ({
  chmod: vi.fn(),
  lstat: vi.fn(),
  mkdir: vi.fn(),
  open: vi.fn(),
}));
vi.mock("node:fs/promises", () => fs);

beforeEach(() => {
  vi.resetAllMocks();
});

function file(
  content: string,
  isFile = true,
): {
  stat: ReturnType<typeof vi.fn>;
  chmod: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
  appendFile: ReturnType<typeof vi.fn>;
  truncate: ReturnType<typeof vi.fn>;
} {
  return {
    stat: vi
      .fn()
      .mockResolvedValue({
        size: Buffer.byteLength(content),
        isFile: () => isFile,
      }),
    chmod: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    read: vi.fn(
      async (
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
      ) => {
        Buffer.from(content).copy(buffer, offset, position, position + length);
      },
    ),
    appendFile: vi.fn().mockResolvedValue(undefined),
    truncate: vi.fn().mockResolvedValue(undefined),
  };
}

describe("log file preparation", () => {
  it("permits only real directories", async () => {
    fs.lstat
      .mockResolvedValueOnce({
        isDirectory: () => true,
        isSymbolicLink: () => false,
      })
      .mockResolvedValueOnce({
        isDirectory: () => true,
        isSymbolicLink: () => true,
      });
    await prepareLogDirectory("/virtual/logs");
    expect(fs.chmod).toHaveBeenCalledWith("/virtual/logs", 0o700);
    await expect(prepareLogDirectory("/virtual/link")).rejects.toThrow(
      "real directory",
    );
  });

  it("preserves complete records and repairs torn tails", async () => {
    for (const [content, appended, truncated] of [
      ["", false, null],
      ['{"ok":true}\n', false, null],
      ['{"ok":true}', true, null],
      ['{"ok":true}\n{"broken":', false, 12],
      ["[]", false, 0],
    ] as const) {
      const handle = file(content);
      fs.open.mockResolvedValueOnce(handle);
      await openDailyLog("/virtual/logs", "2026-01-01");
      expect(handle.appendFile).toHaveBeenCalledTimes(appended ? 1 : 0);
      if (truncated === null) expect(handle.truncate).not.toHaveBeenCalled();
      else expect(handle.truncate).toHaveBeenCalledWith(truncated);
    }
  });

  it("closes a file that is not regular", async () => {
    const handle = file("", false);
    fs.open.mockResolvedValue(handle);
    await expect(openDailyLog("/virtual/logs", "2026-01-01")).rejects.toThrow(
      "regular file",
    );
    expect(handle.close).toHaveBeenCalledOnce();
  });
});
