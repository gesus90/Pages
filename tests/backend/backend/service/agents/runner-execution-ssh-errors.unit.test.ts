import { beforeEach, expect, it, vi } from "vitest";

import { sshConfigOverlay } from "../../../../../scripts/runner/execution.mjs";

const filesystem = vi.hoisted(() => ({
  readdir: vi.fn(),
  open: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("node:fs/promises", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ...filesystem,
}));

beforeEach(() => {
  for (const mock of Object.values(filesystem)) mock.mockReset();
  filesystem.readdir.mockResolvedValue(["10.conf"]);
  filesystem.mkdir.mockResolvedValue(undefined);
  filesystem.writeFile.mockResolvedValue(undefined);
  filesystem.rm.mockResolvedValue(undefined);
});

it("copies a trusted file read in multiple chunks and closes its handle", async () => {
  const content = Buffer.from("Host x\n");
  const read = vi
    .fn()
    .mockImplementation(
      (buffer: Buffer, offset: number, length: number, position: number) => {
        const count = Math.min(length, 3, content.length - position);
        content.copy(buffer, offset, position, position + count);
        return Promise.resolve({ bytesRead: count });
      },
    );
  const close = vi.fn().mockResolvedValue(undefined);
  filesystem.open.mockResolvedValue({
    stat: vi.fn().mockResolvedValue({
      isFile: () => true,
      uid: 0,
      mode: 0o644,
      size: content.length,
    }),
    read,
    close,
  });

  await expect(sshConfigOverlay("/copies", "/system")).resolves.toEqual([
    "--ro-bind",
    "/copies",
    "/etc/ssh/ssh_config.d",
  ]);
  expect(read).toHaveBeenCalledTimes(4);
  expect(close).toHaveBeenCalledOnce();
  expect(filesystem.writeFile).toHaveBeenCalledWith(
    "/copies/10.conf",
    content,
    {
      mode: 0o444,
      flag: "wx",
    },
  );
});

it("closes a file that changes during reading and creates no overlay", async () => {
  const close = vi.fn().mockResolvedValue(undefined);
  filesystem.open.mockResolvedValue({
    stat: vi.fn().mockResolvedValue({
      isFile: () => true,
      uid: 0,
      mode: 0o644,
      size: 5,
    }),
    read: vi.fn().mockResolvedValue({ bytesRead: 0 }),
    close,
  });

  await expect(sshConfigOverlay("/copies", "/system")).resolves.toEqual([]);
  expect(close).toHaveBeenCalledOnce();
  expect(filesystem.mkdir).not.toHaveBeenCalled();
});

it("removes the new overlay when writing a copy fails", async () => {
  const close = vi.fn().mockResolvedValue(undefined);
  filesystem.open.mockResolvedValue({
    stat: vi.fn().mockResolvedValue({
      isFile: () => true,
      uid: 0,
      mode: 0o644,
      size: 0,
    }),
    read: vi.fn().mockResolvedValue({ bytesRead: 0 }),
    close,
  });
  filesystem.writeFile.mockRejectedValue(new Error("disk full"));

  await expect(sshConfigOverlay("/copies", "/system")).resolves.toEqual([]);
  expect(close).toHaveBeenCalledOnce();
  expect(filesystem.rm).toHaveBeenCalledWith("/copies", {
    recursive: true,
    force: true,
  });
});

it.each(["ENOENT", "EACCES", "ELOOP", "ENOTDIR"])(
  "skips a drop-in that cannot be opened with %s",
  async (code) => {
    filesystem.open.mockRejectedValue(Object.assign(new Error(code), { code }));

    await expect(sshConfigOverlay("/copies", "/system")).resolves.toEqual([]);
    expect(filesystem.mkdir).not.toHaveBeenCalled();
  },
);
