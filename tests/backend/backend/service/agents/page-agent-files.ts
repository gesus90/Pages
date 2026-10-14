import path from "node:path";

interface MemoryEntry {
  readonly kind: "directory" | "file";
  readonly content: string;
}

/** The stat result the artifact helpers look at. */
interface MemoryStats {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

function missing(operation: string, target: string): Error {
  return Object.assign(new Error(`ENOENT: ${operation} '${target}'`), {
    code: "ENOENT",
  });
}

function statsOf(entry: MemoryEntry): MemoryStats {
  return {
    isDirectory: () => entry.kind === "directory",
    isFile: () => entry.kind === "file",
    isSymbolicLink: () => false,
  };
}

/**
 * The part of `node:fs/promises` that writes the agent definition files, in memory.
 *
 * @remarks
 * It records every write, so a test can show that nothing but the agent files
 * was written and in which order, without touching the disk of the machine.
 */
export class MemoryFiles {
  /** Locations of files and directories created since the last reset, in order. */
  public readonly writes: string[] = [];
  private entries = new Map<string, MemoryEntry>();
  private isFailing = false;

  /** Starts over with no entries. */
  public reset(): void {
    this.entries = new Map();
    this.writes.length = 0;
    this.isFailing = false;
  }

  /** Makes every following write fail, as a full or read-only disk does. */
  public failWrites(): void {
    this.isFailing = true;
  }

  /** The content of a file, or `undefined`. */
  public read(location: string): string | undefined {
    const entry = this.entries.get(location);
    return entry?.kind === "file" ? entry.content : undefined;
  }

  /** Locations of every file, sorted. */
  public files(): readonly string[] {
    return [...this.entries.entries()]
      .filter(([, entry]) => entry.kind === "file")
      .map(([location]) => location)
      .sort();
  }

  /** Replaces the content of a file directly, as another process could. */
  public tamper(location: string, content: string): void {
    this.entries.set(location, { kind: "file", content });
  }

  /** `mkdir` with `recursive`. */
  public async mkdir(location: string): Promise<void> {
    this.requireWritable(location);
    let current = location;
    while (current !== path.dirname(current) && !this.entries.has(current)) {
      this.entries.set(current, { kind: "directory", content: "" });
      current = path.dirname(current);
    }
  }

  /** `lstat`, which never follows a link; this filesystem has none. */
  public async lstat(location: string): Promise<MemoryStats> {
    const entry = this.entries.get(location);
    if (!entry) throw missing("lstat", location);
    return statsOf(entry);
  }

  /** `readFile` as text. */
  public async readFile(location: string): Promise<string> {
    const content = this.read(location);
    if (content === undefined) throw missing("readFile", location);
    return content;
  }

  /** `writeFile` with the `wx` flag the artifact helper uses. */
  public async writeFile(location: string, content: string): Promise<void> {
    this.requireWritable(location);
    this.entries.set(location, { kind: "file", content });
    this.writes.push(location);
  }

  /** `rename` of a file. */
  public async rename(from: string, to: string): Promise<void> {
    this.requireWritable(to);
    const entry = this.entries.get(from);
    if (!entry) throw missing("rename", from);
    this.entries.delete(from);
    this.entries.set(to, entry);
  }

  /** `rm` with `force`. */
  public async rm(location: string): Promise<void> {
    this.entries.delete(location);
  }

  private requireWritable(location: string): void {
    if (this.isFailing)
      throw Object.assign(new Error(`EACCES: '${location}'`), {
        code: "EACCES",
      });
  }
}

/** The one in-memory filesystem the agent tests of a file share. */
export const memoryFiles = new MemoryFiles();

/** The module `node:fs/promises` is replaced with in the agent definition tests. */
export function memoryFilesModule(): Readonly<Record<string, unknown>> {
  const functions = {
    mkdir: (location: string): Promise<void> => memoryFiles.mkdir(location),
    lstat: (location: string): Promise<MemoryStats> =>
      memoryFiles.lstat(location),
    readFile: (location: string): Promise<string> =>
      memoryFiles.readFile(location),
    writeFile: (location: string, content: string): Promise<void> =>
      memoryFiles.writeFile(location, content),
    rename: (from: string, to: string): Promise<void> =>
      memoryFiles.rename(from, to),
    rm: (location: string): Promise<void> => memoryFiles.rm(location),
  };
  return { ...functions, default: functions };
}
