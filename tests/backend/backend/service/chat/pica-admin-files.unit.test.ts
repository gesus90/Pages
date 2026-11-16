import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type * as NodeFs from "node:fs";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";

const boundary = vi.hoisted(() => ({
  withFile: vi.fn(),
  location: vi.fn(),
  fstat: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  truncate: vi.fn(),
  sync: vi.fn(),
}));
vi.mock("@/backend/service/chat/admin/PicaAdminPaths", () => ({
  withAdminFile: boundary.withFile,
  requireAdminFileLocation: boundary.location,
  adminPathParts: vi.fn(),
  openAdminDirectory: vi.fn(),
}));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof NodeFs>()),
  fstatSync: boundary.fstat,
  readSync: boundary.read,
  writeSync: boundary.write,
  ftruncateSync: boundary.truncate,
  fsyncSync: boundary.sync,
}));

import {
  adminScope,
  PicaAdminFiles,
} from "@/backend/service/chat/admin/PicaAdminFiles";

const context = partial<RuntimeExecutionContext>({
  userId: "user",
  sessionId: "session",
  runId: "run",
  signal: new AbortController().signal,
  authorize: vi.fn(),
});
const contents = "Hello world";

beforeEach(() => {
  vi.resetAllMocks();
  boundary.withFile.mockImplementation(async (input) => input.work({ fd: 10 }));
  boundary.fstat.mockReturnValue({
    isFile: () => true,
    nlink: 1,
    size: contents.length,
    dev: 1,
    ino: 2,
    mtimeNs: 3,
    ctimeNs: 4,
  });
  boundary.read.mockImplementation((fd, buffer: Buffer) => {
    expect(fd).toBe(10);
    return buffer.write(contents);
  });
  boundary.write.mockImplementation((fd, buffer: Buffer) => {
    expect(fd).toBe(10);
    return buffer.length;
  });
});

it("reads and changes one passage only after a scoped revision", async () => {
  const files = new PicaAdminFiles();
  expect(adminScope(context)).toBe(JSON.stringify(["user", "session", "run"]));
  const read = await files.read(context, "note.txt");
  expect(read.content).toBe(contents);
  const authorize = vi.fn();
  expect(
    await files.edit(
      context,
      {
        path: "note.txt",
        revision: read.revision,
        before: "world",
        after: "Pages",
      },
      authorize,
    ),
  ).toEqual({ path: "note.txt", status: "edited", bytes: 11 });
  expect(authorize).toHaveBeenCalledOnce();
  expect(boundary.write).toHaveBeenCalledWith(
    10,
    Buffer.from("Hello Pages"),
    0,
    11,
    0,
  );
  expect(boundary.sync).toHaveBeenCalledOnce();
});

it("rejects revisions from another scope and consumes them", async () => {
  const files = new PicaAdminFiles();
  const read = await files.read(context, "note.txt");
  const input = {
    path: "note.txt",
    revision: read.revision,
    before: "world",
    after: "Pages",
  };
  await expect(
    files.edit(
      partial<RuntimeExecutionContext>({ ...context, userId: "other" }),
      input,
      async () => undefined,
    ),
  ).rejects.toThrow();
  await expect(
    files.edit(context, input, async () => undefined),
  ).rejects.toThrow();
  expect(boundary.write).not.toHaveBeenCalled();
});

it("rejects a changed file and ambiguous or sensitive replacements", async () => {
  const files = new PicaAdminFiles();
  const first = await files.read(context, "note.txt");
  boundary.fstat.mockReturnValueOnce({
    isFile: () => true,
    nlink: 1,
    size: contents.length,
    dev: 1,
    ino: 2,
    mtimeNs: 9,
    ctimeNs: 4,
  });
  boundary.fstat.mockReturnValueOnce({
    isFile: () => true,
    nlink: 1,
    size: contents.length,
    dev: 1,
    ino: 2,
    mtimeNs: 9,
    ctimeNs: 4,
  });
  await expect(
    files.edit(
      context,
      {
        path: "note.txt",
        revision: first.revision,
        before: "world",
        after: "Pages",
      },
      async () => undefined,
    ),
  ).rejects.toThrow();
  const second = await files.read(context, "note.txt");
  await expect(
    files.edit(
      context,
      {
        path: "note.txt",
        revision: second.revision,
        before: "missing",
        after: "Pages",
      },
      async () => undefined,
    ),
  ).rejects.toThrow();
  const third = await files.read(context, "note.txt");
  await expect(
    files.edit(
      context,
      {
        path: "note.txt",
        revision: third.revision,
        before: "world",
        after: "password=secret",
      },
      async () => undefined,
    ),
  ).rejects.toThrow();
  expect(boundary.write).not.toHaveBeenCalled();
});
