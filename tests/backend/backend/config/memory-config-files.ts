/** Options `node:fs/promises` receives for a file write. */
interface WriteOptions {
  readonly flag?: string;
  readonly mode?: number;
}

function codedError(code: string, target: string): Error {
  return Object.assign(new Error(`${code}: '${target}'`), { code });
}

/**
 * An in-memory stand-in for the file functions the configuration code uses.
 *
 * @remarks
 * Tests replace `node:fs/promises` and `node:fs` with it, so no configuration
 * file and no directory of the machine is ever touched.
 */
export class MemoryConfigFiles {
  /** File content by absolute path. */
  public readonly files = new Map<string, string>();
  /** Mode a file was written with, by absolute path. */
  public readonly modes = new Map<string, number>();
  /** Directories created through `mkdir`, with their modes. */
  public readonly directories = new Map<string, number>();
  /** Error thrown by the next calls of the named function, until reset. */
  public readonly failures = new Map<string, Error>();

  /** Forgets every file, mode, directory and failure. */
  public reset(): void {
    this.files.clear();
    this.modes.clear();
    this.directories.clear();
    this.failures.clear();
  }

  /** The functions of `node:fs/promises` the configuration code calls. */
  public promisesModule(): Readonly<Record<string, unknown>> {
    const functions = {
      mkdir: async (location: string, options: { mode?: number }) => {
        this.fail("mkdir");
        this.directories.set(location, options.mode ?? 0o777);
      },
      readFile: async (location: string) => {
        this.fail("readFile");
        const content = this.files.get(location);
        if (content === undefined) throw codedError("ENOENT", location);
        return content;
      },
      rename: async (from: string, to: string) => {
        this.fail("rename");
        const content = this.files.get(from);
        if (content === undefined) throw codedError("ENOENT", from);
        this.files.delete(from);
        this.files.set(to, content);
        this.modes.set(to, this.modes.get(from) ?? 0o666);
      },
      rm: async (location: string) => {
        this.files.delete(location);
        this.modes.delete(location);
      },
      writeFile: async (
        location: string,
        content: string,
        options: WriteOptions,
      ) => {
        this.fail("writeFile");
        if (options.flag === "wx" && this.files.has(location))
          throw codedError("EEXIST", location);
        this.files.set(location, content);
        this.modes.set(location, options.mode ?? 0o666);
      },
    };
    return { ...functions, default: functions };
  }

  /** The functions of `node:fs` the configuration code calls. */
  public syncModule(): Readonly<Record<string, unknown>> {
    const functions = {
      existsSync: (location: string): boolean => this.files.has(location),
    };
    return { ...functions, default: functions };
  }

  private fail(name: string): void {
    const failure = this.failures.get(name);
    if (failure !== undefined) throw failure;
  }
}

/** The one in-memory file set that tests mocking the file modules share. */
export const memoryConfigFiles = new MemoryConfigFiles();
