import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SystemDiskMonitor } from "./SystemDiskMonitor";

import type { FileSystemProbe, SystemSources } from "./SystemSources";

const usage = { size: 10, used: 4, free: 6 };

function sourcesOf(
  table: string | null,
  probe: (mountPoint: string) => FileSystemProbe,
): SystemSources {
  return {
    readText: async () => table,
    listDirectory: async () => [],
    probeFileSystem: probe,
    measureDirectory: async () => null,
    now: () => 0,
    userId: null,
  };
}

function finishedWith(result: typeof usage | null): FileSystemProbe {
  return { finished: Promise.resolve(result), stop: vi.fn() };
}

describe("SystemDiskMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns nothing without a mount table", async () => {
    const monitor = new SystemDiskMonitor(
      sourcesOf(null, () => finishedWith(usage)),
    );
    expect(await monitor.read()).toEqual([]);
  });

  it("lists data mounts once, sorted, decoded and filtered", async () => {
    const table = [
      "proc /proc proc rw 0 0",
      "tmpfs /run tmpfs rw 0 0",
      "none relative ext4 rw 0 0",
      "shortline",
      "/dev/b /mnt/b ext4 rw 0 0",
      "/dev/a /data\\040disk ext4 rw 0 0",
      "/dev/b /mnt/c ext4 rw 0 0",
      "/dev/z /mnt/virtual fuse.portal rw 0 0",
      "host:/x /mnt/net fuse.sshfs rw 0 0",
      "/dev/q /mnt/over ext4 rw 0 0",
      "/dev/r /mnt/over ext4 rw 0 0",
    ].join("\n");
    const probe = vi.fn(() => finishedWith(usage));
    const monitor = new SystemDiskMonitor(sourcesOf(table, probe));
    const disks = await monitor.read();
    expect(disks.map((disk) => disk.mountPoint)).toEqual([
      "/data disk",
      "/mnt/b",
      "/mnt/net",
      "/mnt/over",
    ]);
    expect(disks[0]).toEqual({
      mountPoint: "/data disk",
      isReachable: true,
      ...usage,
    });
  });

  it("marks failed measurements as unreachable", async () => {
    const monitor = new SystemDiskMonitor(
      sourcesOf("/dev/a /a ext4 rw 0 0", () => finishedWith(null)),
    );
    expect(await monitor.read()).toEqual([
      { mountPoint: "/a", isReachable: false },
    ]);
  });

  it("gives up on a hanging probe and starts no second one", async () => {
    const stop = vi.fn();
    let release: (result: typeof usage | null) => void = () => undefined;
    const probe = vi.fn((): FileSystemProbe => ({
      finished: new Promise((resolve) => (release = resolve)),
      stop,
    }));
    const monitor = new SystemDiskMonitor(
      sourcesOf("/dev/a /a ext4 rw 0 0", probe),
    );
    const first = monitor.read();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await first).toEqual([{ mountPoint: "/a", isReachable: false }]);
    expect(stop).toHaveBeenCalledOnce();
    expect(await monitor.read()).toEqual([
      { mountPoint: "/a", isReachable: false },
    ]);
    expect(probe).toHaveBeenCalledOnce();
    release(null);
    await vi.advanceTimersByTimeAsync(0);
    const third = monitor.read();
    await vi.advanceTimersByTimeAsync(1000);
    await third;
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
