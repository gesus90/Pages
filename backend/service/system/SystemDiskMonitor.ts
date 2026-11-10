import { MAXIMUM_DASHBOARD_DISKS } from "@/definition/SystemDashboard";

import type { DashboardDisk } from "@/definition/SystemDashboard";
import type { FileSystemProbe, SystemSources } from "./SystemSources";

/** A file system that does not answer within this time counts as unreachable. */
const PROBE_TIMEOUT_MS = 1000;
const MOUNT_TABLE = "/proc/self/mounts";

/** File systems of the kernel and of containers that hold no data of their own. */
const PSEUDO_FILE_SYSTEMS: ReadonlySet<string> = new Set([
  "autofs",
  "binfmt_misc",
  "bpf",
  "cgroup",
  "cgroup2",
  "configfs",
  "debugfs",
  "devpts",
  "devtmpfs",
  "efivarfs",
  "fuse",
  "fusectl",
  "hugetlbfs",
  "mqueue",
  "nsfs",
  "overlay",
  "proc",
  "pstore",
  "ramfs",
  "rootfs",
  "rpc_pipefs",
  "securityfs",
  "selinuxfs",
  "squashfs",
  "sysfs",
  "tmpfs",
  "tracefs",
]);

/** FUSE file systems that reach a network share; every other FUSE mount is local and virtual. */
const NETWORK_FUSE_FILE_SYSTEMS: ReadonlySet<string> = new Set([
  "fuse.sshfs",
  "fuse.rclone",
  "fuse.s3fs",
  "fuse.gcsfuse",
  "fuse.davfs",
  "fuse.glusterfs",
  "fuse.ceph-fuse",
  "fuse.cephfs",
]);

/** Marks a probe that did not finish in time. */
const TIMED_OUT = Symbol("timed out");

interface MountEntry {
  /** The device or share; used to list it once, never shown. */
  readonly source: string;
  readonly mountPoint: string;
  readonly type: string;
}

/** Decodes the octal escapes of the mount table, such as `\040` for a space. */
function decodeMountField(field: string): string {
  return field.replace(/\\[0-7]{3}/gu, (escape) =>
    String.fromCharCode(Number.parseInt(escape.slice(1), 8)),
  );
}

function readMountEntry(line: string): MountEntry | null {
  const [source, mountPoint, type] = line.split(" ");
  if (source === undefined || mountPoint === undefined || type === undefined)
    return null;
  return {
    source: decodeMountField(source),
    mountPoint: decodeMountField(mountPoint),
    type,
  };
}

function holdsData(entry: MountEntry): boolean {
  if (!entry.mountPoint.startsWith("/")) return false;
  if (entry.type.startsWith("fuse."))
    return NETWORK_FUSE_FILE_SYSTEMS.has(entry.type);
  return !PSEUDO_FILE_SYSTEMS.has(entry.type);
}

/**
 * Lists the mounted file systems that hold data, each once, by mount point.
 *
 * @param table - The text of `/proc/self/mounts`.
 * @returns Real drives and network shares; a mount point mounted over keeps
 * its top entry, and a device or share mounted at several places appears at
 * the first of them.
 */
function listDataMounts(table: string): readonly MountEntry[] {
  const byMountPoint = new Map<string, MountEntry>();
  for (const entry of table.split("\n").map(readMountEntry)) {
    if (entry !== null && holdsData(entry))
      byMountPoint.set(entry.mountPoint, entry);
  }
  const sources = new Set<string>();
  return [...byMountPoint.values()]
    .toSorted((first, second) =>
      first.mountPoint < second.mountPoint ? -1 : 1,
    )
    .filter((entry) => {
      if (sources.has(entry.source)) return false;
      sources.add(entry.source);
      return true;
    });
}

async function settleWithin<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Measures every mounted file system on its own, so a hanging one delays nothing else.
 *
 * @remarks
 * Each file system is measured in a child process with a limit of one
 * second. While the measurement of a file system is still running, even after
 * it was given up, no second one starts: it counts as unreachable until its
 * child has ended, so a hanging network drive never piles up processes.
 */
export class SystemDiskMonitor {
  private readonly sources: SystemSources;
  private readonly running = new Map<string, FileSystemProbe>();

  /**
   * Creates the monitor.
   *
   * @param sources - Reader of the mount table and starter of the measurements.
   */
  public constructor(sources: SystemSources) {
    this.sources = sources;
  }

  /** Measures the file systems mounted right now, in the order of their mount points. */
  public async read(): Promise<DashboardDisk[]> {
    const table = await this.sources.readText(MOUNT_TABLE);
    if (table === null) return [];
    const mounts = listDataMounts(table).slice(0, MAXIMUM_DASHBOARD_DISKS);
    return Promise.all(mounts.map((mount) => this.measure(mount.mountPoint)));
  }

  private async measure(mountPoint: string): Promise<DashboardDisk> {
    const unreachable: DashboardDisk = { mountPoint, isReachable: false };
    if (this.running.has(mountPoint)) return unreachable;
    const probe = this.sources.probeFileSystem(mountPoint);
    this.running.set(mountPoint, probe);
    void probe.finished.then(() => this.running.delete(mountPoint));
    const usage = await settleWithin(probe.finished, PROBE_TIMEOUT_MS);
    if (usage === TIMED_OUT) {
      probe.stop();
      return unreachable;
    }
    return usage === null
      ? unreachable
      : { mountPoint, isReachable: true, ...usage };
  }
}
