import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { LogWriterLock } from "@/backend/logging/LogWriterLock";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  readFile: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  open: mocks.open,
  readFile: mocks.readFile,
}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));

function handle(record = ""): {
  fd: number;
  stat: ReturnType<typeof vi.fn>;
  chmod: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  truncate: ReturnType<typeof vi.fn>;
  datasync: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  return {
    fd: 9,
    stat: vi.fn().mockResolvedValue({
      isFile: () => true,
      nlink: 1,
      size: Buffer.byteLength(record),
    }),
    chmod: vi.fn().mockResolvedValue(undefined),
    read: vi.fn(async (buffer: Buffer) => {
      const bytesRead = buffer.write(record);
      return { bytesRead };
    }),
    write: vi.fn(async (buffer: Buffer, offset: number, length: number) => ({
      bytesWritten: Math.min(length, buffer.length - offset),
    })),
    truncate: vi.fn().mockResolvedValue(undefined),
    datasync: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readFile.mockImplementation(async (name: string) =>
    name.includes("boot_id")
      ? "boot"
      : `1 (node) ${Array(20).fill("1").join(" ")}`,
  );
  mocks.spawn.mockImplementation(() => {
    const process = new EventEmitter();
    queueMicrotask(() => process.emit("close", 0));
    return process;
  });
});

describe("exclusive log writer lock", () => {
  it("acquires and releases a fresh lock, keeping the descriptor until release", async () => {
    const file = handle();
    mocks.open.mockResolvedValue(file);
    const lock = new LogWriterLock("instance");
    await expect(lock.acquire("/virtual")).resolves.toBe("none");
    expect(lock.isHeld()).toBe(true);
    await expect(lock.acquire("/virtual")).resolves.toBe("none");
    await lock.release();
    expect(lock.isHeld()).toBe(false);
    expect(file.close).toHaveBeenCalledOnce();
  });

  it("recovers old, incomplete and orderly released lock records", async () => {
    for (const [record, expected] of [
      ['{"pid":123,"schemaVersion":2}', "stale_owner"],
      ['{"pid":123,"schemaVersion":2,"released":true}', "none"],
      ["partial", "incomplete_record"],
    ] as const) {
      const file = handle(record);
      mocks.open
        .mockRejectedValueOnce(
          Object.assign(new Error("exists"), { code: "EEXIST" }),
        )
        .mockResolvedValueOnce(file);
      const lock = new LogWriterLock("instance");
      await expect(lock.acquire("/virtual")).resolves.toBe(expected);
      await lock.release();
    }
  });

  it("closes invalid files and unavailable or busy locks", async () => {
    const invalid = handle();
    invalid.stat.mockResolvedValue({ isFile: () => false, nlink: 1, size: 0 });
    mocks.open.mockResolvedValueOnce(invalid);
    await expect(
      new LogWriterLock("i").acquire("/virtual"),
    ).rejects.toMatchObject({ code: "LOG_LOCK_INVALID_FILE" });
    expect(invalid.close).toHaveBeenCalledOnce();
    const busy = handle();
    mocks.open.mockResolvedValueOnce(busy);
    mocks.spawn.mockImplementationOnce(() => {
      const process = new EventEmitter();
      queueMicrotask(() => process.emit("close", 75));
      return process;
    });
    await expect(
      new LogWriterLock("i").acquire("/virtual"),
    ).rejects.toMatchObject({ code: "LOG_WRITER_BUSY" });
    expect(busy.close).toHaveBeenCalledOnce();
  });
});
