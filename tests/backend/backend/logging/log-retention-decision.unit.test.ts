import { afterEach, describe, expect, it, vi } from "vitest";

import { LogRetention } from "@/backend/logging/LogRetention";

import { partial } from "../../app/lib/service-wiring-fakes";

import type { DailyLogWriter } from "@/backend/logging/DailyLogWriter";

const files = vi.hoisted(() => ({
  readdir: vi.fn(),
  lstat: vi.fn(),
  unlink: vi.fn(),
}));
vi.mock("node:fs/promises", () => files);

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

function fixture(): {
  retention: LogRetention;
  emit: ReturnType<typeof vi.fn>;
} {
  const writer = partial<DailyLogWriter>({
    withFiles: async <Result>(
      work: (protectedDates: ReadonlySet<string>) => Promise<Result>,
    ): Promise<Result> => work(new Set(["2020-01-02"])),
  });
  const emit = vi.fn();
  return { retention: new LogRetention("/virtual/logs", writer, emit), emit };
}

describe("log retention", () => {
  it("removes only expired unprotected regular files", async () => {
    const { retention, emit } = fixture();
    files.readdir.mockResolvedValue([
      "pages-2020-01-01.jsonl",
      "pages-2020-01-02.jsonl",
      "pages-2020-01-03.jsonl",
      "pages-2999-01-01.jsonl",
      "other",
    ]);
    files.lstat
      .mockResolvedValueOnce({
        isFile: () => true,
        isSymbolicLink: () => false,
      })
      .mockResolvedValueOnce({
        isFile: () => false,
        isSymbolicLink: () => true,
      });
    files.unlink.mockResolvedValue(undefined);
    await retention.update(7);
    expect(files.unlink).toHaveBeenCalledOnce();
    expect(files.unlink).toHaveBeenCalledWith(
      "/virtual/logs/pages-2020-01-01.jsonl",
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "logging.cleanup.completed",
        level: "info",
      }),
    );
    await retention.close();
  });

  it("reports individual and directory errors and rejects invalid settings", async () => {
    const { retention, emit } = fixture();
    await expect(retention.update(-1)).rejects.toThrow("Invalid log retention");
    files.readdir
      .mockResolvedValueOnce(["pages-2020-01-01.jsonl"])
      .mockRejectedValueOnce(new Error("unreadable"));
    files.lstat.mockRejectedValue(new Error("unavailable"));
    await retention.cleanup("manual");
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ event: "logging.cleanup.delete_failed" }),
    );
    await retention.cleanup("retry");
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ event: "logging.cleanup.failed" }),
    );
    await retention.close();
  });
});
