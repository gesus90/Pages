import { Readable, Writable } from "node:stream";

/** Synthetic storage for private snapshots and workspace copies; no host file is opened. */
export class MemoryAssetFiles {
  /** File bytes that a test may change to simulate tampering. */
  public readonly contents = new Map<string, Buffer>();
  /** Synthetic symlinks, rejected at the same boundary as real no-follow opens. */
  public readonly links = new Set<string>();
  private readonly directories = new Set<string>();
  private sequence = 0;

  /** Clears every synthetic file between tests. */
  public reset(): void {
    this.contents.clear();
    this.links.clear();
    this.directories.clear();
    this.sequence = 0;
  }

  /** Replaces a file sink with an in-memory stream. */
  public writer(file: string): Writable {
    const chunks: Buffer[] = [];
    return new Writable({
      write(chunk: Buffer, encoding, done): void {
        chunks.push(Buffer.from(chunk));
        done();
      },
      final: (done): void => {
        this.contents.set(file, Buffer.concat(chunks));
        done();
      },
    });
  }

  /** Provides the filesystem operations used by the two copy owners. */
  public promises(): Record<string, unknown> {
    return {
      mkdir: async (directory: string) => {
        this.directories.add(directory);
      },
      mkdtemp: async (prefix: string) => {
        const directory = `${prefix}${++this.sequence}`;
        this.directories.add(directory);
        return directory;
      },
      realpath: async (file: string) => file,
      lstat: async (file: string) => this.metadata(file),
      open: async (file: string) => {
        if (this.links.has(file)) throw new Error("ELOOP");
        if (!this.directories.has(file)) this.bytes(file);
        return {
          stat: async () => this.metadata(file),
          close: async () => undefined,
          sync: async () => undefined,
          createReadStream: () => Readable.from([this.bytes(file)]),
        };
      },
      writeFile: async (file: string, bytes: Uint8Array) => {
        this.contents.set(file, Buffer.from(bytes));
      },
      rename: async (from: string, to: string) => {
        this.contents.set(to, this.bytes(from));
        this.contents.delete(from);
      },
      rm: async (file: string) => {
        this.contents.delete(file);
        this.directories.delete(file);
        for (const key of this.contents.keys())
          if (key.startsWith(`${file}/`)) this.contents.delete(key);
      },
    };
  }

  private bytes(file: string): Buffer {
    const bytes = this.contents.get(file);
    if (!bytes) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return bytes;
  }

  private metadata(file: string): object {
    const isDirectory = this.directories.has(file);
    return {
      size: isDirectory ? 0 : this.bytes(file).length,
      ino: 1,
      dev: 1,
      isDirectory: () => isDirectory,
      isFile: () => !isDirectory,
      isSymbolicLink: () => this.links.has(file),
    };
  }
}

/** The mock factories of one isolated test module use this single synthetic store. */
export const assetFiles = new MemoryAssetFiles();
