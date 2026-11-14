import path from "node:path";

interface Entry {
  readonly kind: "directory" | "file";
  readonly content: string;
}

/** Private in-memory file boundary, including fsync and atomic publication. */
class JournalFiles {
  public readonly entries = new Map<string, Entry>();
  public readonly removed: string[] = [];
  public readonly synchronized: string[] = [];
  public failSync: string | null = null;
  public failRemove: string | null = null;

  /** Resets synthetic storage without touching any instance files. */
  public reset(): void {
    this.entries.clear();
    this.removed.length = 0;
    this.synchronized.length = 0;
    this.failSync = null;
    this.failRemove = null;
  }

  /** Seeds private files and their containing directories. */
  public seed(location: string, content: string, kind: Entry["kind"] = "file"): void {
    let parent = path.dirname(location);
    while (!this.entries.has(parent)) {
      this.entries.set(parent, { kind: "directory", content: "" });
      if (parent === "/") break;
      parent = path.dirname(parent);
    }
    this.entries.set(location, { kind, content });
  }

  /** Returns the fs/promises operations exercised by journals and the actual payload store. */
  public module(): Record<string, unknown> {
    return {
      mkdir: async (location: string) => {
        if (!this.entries.has(location)) this.seed(location, "", "directory");
      },
      lstat: async (location: string) => this.stats(location),
      readdir: async (directory: string) => {
        this.require(directory);
        return [...this.entries.keys()].filter((location) => location !== directory && path.dirname(location) === directory).map((location) => path.basename(location));
      },
      open: async (location: string, mode: string | number) => {
        if (mode === "wx") {
          if (this.entries.has(location)) throw new Error("Synthetic file exists");
          this.seed(location, "");
        } else this.require(location);
        return {
          writeFile: async (content: string | Buffer) => this.seed(location, content.toString()),
          readFile: async (encoding?: string) => encoding ? this.require(location).content : Buffer.from(this.require(location).content),
          stat: async () => this.stats(location),
          sync: async () => {
            if (this.failSync !== null && location.includes(this.failSync)) throw new Error("Synthetic fsync failure");
            this.synchronized.push(location);
          },
          close: async () => undefined,
        };
      },
      rename: async (source: string, target: string) => {
        this.entries.set(target, this.require(source));
        this.entries.delete(source);
      },
      rm: async (location: string) => {
        if (location === this.failRemove) throw new Error("Synthetic unlink failure");
        this.removed.push(location);
        this.entries.delete(location);
      },
    };
  }

  private require(location: string): Entry {
    const entry = this.entries.get(location);
    if (entry === undefined) throw Object.assign(new Error("Synthetic missing file"), { code: "ENOENT" });
    return entry;
  }

  private stats(location: string): { isDirectory: () => boolean; isFile: () => boolean; uid: number | undefined; mode: number; size: number } {
    const entry = this.require(location);
    return {
      isDirectory: () => entry.kind === "directory",
      isFile: () => entry.kind === "file",
      uid: process.getuid?.(),
      mode: 0o700,
      size: Buffer.byteLength(entry.content),
    };
  }
}

/** One isolated filesystem per test module. */
export const journalFiles = new JournalFiles();
