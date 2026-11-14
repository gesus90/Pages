import path from "node:path";

interface Entry {
  readonly kind: "directory" | "file" | "link";
  readonly content: string;
}

/** Minimal in-memory filesystem boundary for PAGE-352 lifecycle regressions. */
export class AgentEnvironmentFiles {
  public readonly entries = new Map<string, Entry>();
  public readonly removed: string[] = [];

  /** Starts without persistent or live files. */
  public reset(): void {
    this.entries.clear();
    this.removed.length = 0;
  }

  /** Seeds synthetic files and all their parents. */
  public seed(
    location: string,
    kind: Entry["kind"] = "directory",
    content = "",
  ): void {
    let parent = path.dirname(location);
    while (!this.entries.has(parent)) {
      this.entries.set(parent, { kind: "directory", content: "" });
      if (parent === "/") break;
      parent = path.dirname(parent);
    }
    this.entries.set(location, { kind, content });
  }

  /** Replaces only the filesystem functions exercised by the cleanup and setup code. */
  public module(): Record<string, unknown> {
    return {
      mkdir: async (location: string, options?: { recursive?: boolean }) => {
        if (this.entries.has(location) && !options?.recursive)
          throw Object.assign(new Error("Exists"), { code: "EEXIST" });
        if (!this.entries.has(location)) this.seed(location);
      },
      lstat: async (location: string) => {
        const entry = this.require(location);
        return {
          isDirectory: () => entry.kind === "directory",
          isFile: () => entry.kind === "file",
          isSymbolicLink: () => entry.kind === "link",
          uid: process.getuid?.(),
          mode: 0o700,
          mtimeMs: Date.now(),
        };
      },
      access: async (location: string) => {
        this.require(location);
      },
      readdir: async (directory: string) => {
        this.require(directory);
        return [...this.entries]
          .filter(
            ([location]) =>
              path.dirname(location) === directory && location !== directory,
          )
          .map(([location, entry]) => ({
            name: path.basename(location),
            isDirectory: () => entry.kind === "directory",
          }));
      },
      rm: async (directory: string) => {
        this.removed.push(directory);
        for (const location of this.entries.keys())
          if (location === directory || location.startsWith(`${directory}/`))
            this.entries.delete(location);
      },
      open: async (location: string) => {
        this.seed(location, "file");
        return { close: async () => undefined };
      },
      rename: async (source: string, target: string) => {
        this.require(source);
        for (const [location, entry] of [...this.entries]) {
          if (location !== source && !location.startsWith(`${source}/`))
            continue;
          this.entries.set(target + location.slice(source.length), entry);
          this.entries.delete(location);
        }
      },
      readFile: async (location: string) => this.require(location).content,
      writeFile: async (location: string, content: string) => {
        this.seed(location, "file", content);
      },
    };
  }

  private require(location: string): Entry {
    const entry = this.entries.get(location);
    if (!entry)
      throw Object.assign(new Error("Missing synthetic entry"), {
        code: "ENOENT",
      });
    return entry;
  }
}

/** One boundary per isolated test module. */
export const environmentFiles = new AgentEnvironmentFiles();
