import path from "node:path";

type Entry =
  | { readonly kind: "directory"; readonly inode: bigint }
  | { readonly kind: "file"; readonly inode: bigint }
  | { readonly kind: "link"; readonly target: string };

/** What the code under test sees of a directory entry. */
export interface MemoryDirent {
  readonly name: string;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

/** What the code under test sees of a stat call. */
export interface MemoryStats {
  readonly dev: bigint;
  readonly ino: bigint;
  isDirectory(): boolean;
}

function failure(code: string, operation: string, target: string): Error {
  return Object.assign(new Error(`${code}: ${operation} '${target}'`), {
    code,
  });
}

/**
 * An in-memory stand-in for the part of `node:fs/promises` that reads metadata.
 *
 * @remarks
 * It records the name of every call, so a test can show that a registry
 * operation only looked at directories. Writing functions do not exist on it.
 */
export class MemoryFilesystem {
  /** Names of the functions called since the last reset, in call order. */
  public readonly calls: string[] = [];
  private entries = new Map<string, Entry>();
  private readonly denied = new Set<string>();
  private nextInode = 1n;

  /** Starts over with an empty filesystem that only has its root. */
  public reset(): void {
    this.entries = new Map();
    this.denied.clear();
    this.calls.length = 0;
    this.nextInode = 1n;
    this.addDirectory("/");
  }

  /** Creates a directory and every parent. */
  public addDirectory(location: string): void {
    let current = location;
    while (!this.entries.has(current)) {
      this.entries.set(current, { kind: "directory", inode: this.nextInode });
      this.nextInode += 1n;
      current = path.dirname(current);
    }
  }

  /** Creates a regular file; its parent directories are created as well. */
  public addFile(location: string): void {
    this.addDirectory(path.dirname(location));
    this.entries.set(location, { kind: "file", inode: this.nextInode });
    this.nextInode += 1n;
  }

  /** Creates a symbolic link to `target`. */
  public addLink(location: string, target: string): void {
    this.addDirectory(path.dirname(location));
    this.entries.set(location, { kind: "link", target });
  }

  /** Deletes a directory and everything below it, as another process may. */
  public removeDirectory(location: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key === location || key.startsWith(`${location}${path.sep}`))
        this.entries.delete(key);
    }
  }

  /** Makes `access` refuse the directory, as a missing permission does. */
  public deny(location: string): void {
    this.denied.add(location);
  }

  /** Whether the location exists, without recording a call. */
  public has(location: string): boolean {
    return this.entries.has(location);
  }

  /** The sorted locations below the filesystem root, to compare before and after. */
  public snapshot(): readonly string[] {
    return [...this.entries.keys()].sort();
  }

  /** `dev:ino` of a directory as `stat` reports it, without recording a call. */
  public identityOf(location: string): string {
    const entry = this.entries.get(this.resolve(location));
    if (entry === undefined || entry.kind === "link")
      throw failure("ENOENT", "identityOf", location);
    return `1:${entry.inode}`;
  }

  /** `realpath`: the canonical location, or `ENOENT`. */
  public async realpath(input: string): Promise<string> {
    this.calls.push("realpath");
    return this.resolve(input);
  }

  /** `stat` of a file or directory; a link is followed. */
  public async stat(input: string): Promise<MemoryStats> {
    this.calls.push("stat");
    const entry = this.entries.get(this.resolve(input));
    if (entry === undefined || entry.kind === "link")
      throw failure("ENOENT", "stat", input);
    return {
      dev: 1n,
      ino: entry.inode,
      isDirectory: () => entry.kind === "directory",
    };
  }

  /** `access`: succeeds unless the location was denied. */
  public async access(input: string): Promise<void> {
    this.calls.push("access");
    const location = this.resolve(input);
    if (this.denied.has(location)) throw failure("EACCES", "access", input);
  }

  /** `readdir` with file types: the direct children of a directory. */
  public async readdir(input: string): Promise<readonly MemoryDirent[]> {
    this.calls.push("readdir");
    const directory = this.resolve(input);
    return [...this.entries.entries()]
      .filter(
        ([location]) =>
          location !== directory && path.dirname(location) === directory,
      )
      .map(([location, entry]) => ({
        name: path.basename(location),
        isDirectory: () => entry.kind === "directory",
        isSymbolicLink: () => entry.kind === "link",
      }));
  }

  /** Follows links component by component, like `realpath`. */
  private resolve(input: string): string {
    const pending = path.resolve(input).split(path.sep).filter(Boolean);
    let current: string = path.sep;
    let hops = 0;
    for (let name = pending.shift(); name !== undefined;) {
      const next = path.join(current, name);
      const entry = this.entries.get(next);
      if (entry === undefined) throw failure("ENOENT", "resolve", input);
      if (entry.kind === "link") {
        hops += 1;
        if (hops > 16) throw failure("ELOOP", "resolve", input);
        const target = path.resolve(path.dirname(next), entry.target);
        pending.unshift(...target.split(path.sep).filter(Boolean));
        current = path.sep;
      } else current = next;
      name = pending.shift();
    }
    return current;
  }
}

/** The one filesystem every test file that mocks `node:fs/promises` shares. */
export const memoryFilesystem = new MemoryFilesystem();

/** The module `node:fs/promises` is replaced with: only the metadata functions exist. */
export function memoryFilesystemModule(): Readonly<Record<string, unknown>> {
  const functions = {
    realpath: (input: string): Promise<string> =>
      memoryFilesystem.realpath(input),
    stat: (input: string): Promise<MemoryStats> => memoryFilesystem.stat(input),
    access: (input: string): Promise<void> => memoryFilesystem.access(input),
    readdir: (input: string): Promise<readonly MemoryDirent[]> =>
      memoryFilesystem.readdir(input),
  };
  return { ...functions, default: functions };
}
