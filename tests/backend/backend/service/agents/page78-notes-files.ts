import path from "node:path";

interface NotesEntry {
  readonly kind: "file" | "directory" | "link";
  readonly content: string;
  readonly mode: number;
  readonly uid: number;
  readonly mtimeMs: number;
}

interface WriteOptions {
  readonly mode?: number;
  readonly recursive?: boolean;
  readonly flag?: string;
}

function filesystemError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/** A filesystem boundary that preserves exclusive creates, permissions and symlinks. */
export class NotesFiles {
  public readonly entries = new Map<string, NotesEntry>();
  public readonly writes: string[] = [];
  public failFile: string | null = null;

  /** Starts with a private home and a working copy outside it. */
  public reset(): void {
    this.entries.clear();
    this.writes.length = 0;
    this.failFile = null;
    for (const directory of [
      "/",
      "/synthetic",
      "/synthetic/home",
      "/notes",
      "/notes/home",
      "/work",
    ])
      this.put(directory, "directory");
  }

  /** Adds a file, directory or symlink without simulating a write. */
  public put(
    location: string,
    kind: NotesEntry["kind"],
    content = "",
    options: Partial<NotesEntry> = {},
  ): void {
    this.entries.set(location, {
      kind,
      content,
      mode: 0o700,
      uid: process.getuid?.() ?? 0,
      mtimeMs: Date.now(),
      ...options,
    });
  }

  /** Looks up metadata without following the final symlink. */
  public async lstat(location: string): Promise<
    NotesEntry & {
      isDirectory: () => boolean;
      isFile: () => boolean;
      isSymbolicLink: () => boolean;
    }
  > {
    const entry = this.entries.get(location);
    if (!entry) throw filesystemError("ENOENT");
    return {
      ...entry,
      isDirectory: () => entry.kind === "directory",
      isFile: () => entry.kind === "file",
      isSymbolicLink: () => entry.kind === "link",
    };
  }

  /** Resolves links in parents too, so overlap checks exercise canonical paths. */
  public async realpath(location: string): Promise<string> {
    let current = "/";
    const parts = path.resolve(location).split("/").filter(Boolean);
    for (const part of parts) {
      current = path.join(current, part);
      const entry = this.entries.get(current);
      if (!entry) throw filesystemError("ENOENT");
      if (entry.kind === "link") current = await this.realpath(entry.content);
    }
    return current;
  }

  /** Honors exclusive directory creation instead of silently adopting an existing run. */
  public async mkdir(
    location: string,
    options: WriteOptions = {},
  ): Promise<void> {
    if (this.entries.has(location)) {
      if (options.recursive) return;
      throw filesystemError("EEXIST");
    }
    if (!this.entries.has(path.dirname(location))) {
      if (!options.recursive) throw filesystemError("ENOENT");
      await this.mkdir(path.dirname(location), options);
    }
    this.put(location, "directory", "", { mode: options.mode ?? 0o777 });
    this.writes.push(location);
  }

  /** Honors wx and can fail one write to exercise partial-start rollback. */
  public async writeFile(
    location: string,
    content: string,
    options: WriteOptions = {},
  ): Promise<void> {
    if (this.failFile === path.basename(location))
      throw filesystemError("ENOSPC");
    if (options.flag === "wx" && this.entries.has(location))
      throw filesystemError("EEXIST");
    this.put(location, "file", content, { mode: options.mode ?? 0o600 });
    this.writes.push(location);
  }

  /** Removes links themselves, without touching any target. */
  public async rm(location: string): Promise<void> {
    for (const filename of [...this.entries.keys()])
      if (filename === location || filename.startsWith(`${location}/`))
        this.entries.delete(filename);
  }

  /** Lists direct children with their own type, never the type of a link target. */
  public async readdir(location: string): Promise<
    readonly {
      name: string;
      isDirectory: () => boolean;
      isSymbolicLink: () => boolean;
    }[]
  > {
    return [...this.entries]
      .filter(
        ([filename]) =>
          path.dirname(filename) === location && filename !== location,
      )
      .map(([filename, entry]) => ({
        name: path.basename(filename),
        isDirectory: () => entry.kind === "directory",
        isSymbolicLink: () => entry.kind === "link",
      }));
  }
}

/** Shared only by tests that replace the filesystem module with notesFilesModule. */
export const notesFiles = new NotesFiles();

/** The mocked filesystem module; no operation reaches the host. */
export function notesFilesModule(): Readonly<Record<string, unknown>> {
  return {
    lstat: notesFiles.lstat.bind(notesFiles),
    realpath: notesFiles.realpath.bind(notesFiles),
    mkdir: notesFiles.mkdir.bind(notesFiles),
    writeFile: notesFiles.writeFile.bind(notesFiles),
    rm: notesFiles.rm.bind(notesFiles),
    readdir: notesFiles.readdir.bind(notesFiles),
  };
}
