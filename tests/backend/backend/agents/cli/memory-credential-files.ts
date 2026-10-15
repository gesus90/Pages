import path from "node:path";

interface Entry {
  readonly kind: "directory" | "file" | "link";
  readonly mode: number;
}

/** File metadata only; credential content is never stored or read. */
export class MemoryCredentialFiles {
  public readonly entries = new Map<string, Entry>();
  public readonly changedModes: string[] = [];
  public readonly removed: string[] = [];
  public failure: Error | null = null;

  /** Starts each unit with a synthetic data directory. */
  public reset(): void {
    this.entries.clear();
    this.changedModes.length = 0;
    this.removed.length = 0;
    this.failure = null;
    this.seed("/memory/pages", "directory");
  }

  /** Adds a directory, regular file or link without touching the filesystem. */
  public seed(location: string, kind: Entry["kind"], mode = 0o755): void {
    this.entries.set(location, { kind, mode });
  }

  /** Exposes only the filesystem operations the credential store may use. */
  public module(): Readonly<Record<string, unknown>> {
    return {
      lstat: async (location: string) => {
        const entry = this.entry(location);
        return { isDirectory: () => entry.kind === "directory" };
      },
      mkdir: async (location: string, options: { mode: number }) => {
        this.seed(location, "directory", options.mode);
      },
      chmod: async (location: string, mode: number) => {
        const entry = this.entry(location);
        this.changedModes.push(location);
        this.entries.set(location, { ...entry, mode });
      },
      readdir: async (directory: string) => {
        this.entry(directory);
        return [...this.entries.entries()]
          .filter(([location]) => path.dirname(location) === directory)
          .map(([location, entry]) => ({
            name: path.basename(location),
            isDirectory: () => entry.kind === "directory",
            isSymbolicLink: () => entry.kind === "link",
          }));
      },
      rm: async (directory: string) => {
        this.entry(directory);
        this.removed.push(directory);
        for (const location of this.entries.keys()) {
          if (location === directory || location.startsWith(`${directory}/`)) {
            this.entries.delete(location);
          }
        }
      },
    };
  }

  private entry(location: string): Entry {
    if (this.failure !== null) throw this.failure;
    const entry = this.entries.get(location);
    if (entry === undefined) {
      throw Object.assign(new Error("Missing synthetic entry"), {
        code: "ENOENT",
      });
    }
    return entry;
  }
}

/** One isolated module instance per Vitest worker. */
export const credentialFiles = new MemoryCredentialFiles();
