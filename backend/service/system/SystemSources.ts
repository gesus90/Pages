import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";

/** A child process prints a few numbers; anything longer is not a measurement. */
const MAXIMUM_CHILD_OUTPUT = 4096;

/** The usage of one file system in bytes, as `df` reports it. */
export interface FileSystemUsage {
  readonly size: number;
  readonly used: number;
  /** Space available to unprivileged processes. */
  readonly free: number;
}

/** One running measurement of a file system in a child process of its own. */
export interface FileSystemProbe {
  /**
   * Settles when the child process has ended, however long that takes, with
   * the usage or `null` when it could not be measured. It never rejects.
   */
  readonly finished: Promise<FileSystemUsage | null>;
  /** Ends the child; a child stuck in the kernel ends once the kernel lets it. */
  readonly stop: () => void;
}

/**
 * The exchangeable readers of the system dashboard (PAGE-282).
 *
 * @remarks
 * Every source of the server goes through one of them, so a hanging network
 * drive, a missing swap, temperature source or ACP control group can be put
 * in place of the real one.
 */
export interface SystemSources {
  /** Reads a file below `/proc` or `/sys`; `null` when it is missing or unreadable. */
  readonly readText: (path: string) => Promise<string | null>;
  /** Lists the entries of a directory; empty when it is missing. */
  readonly listDirectory: (path: string) => Promise<readonly string[]>;
  /** Starts the measurement of one file system outside Node's thread pool. */
  readonly probeFileSystem: (mountPoint: string) => FileSystemProbe;
  /** Measures the disk usage of a directory tree in bytes; `null` on failure or timeout. */
  readonly measureDirectory: (
    directory: string,
    timeoutMs: number,
  ) => Promise<number | null>;
  /** The current time in milliseconds since the epoch. */
  readonly now: () => number;
  /** The account running Pages, whose user manager holds `pages-acp.slice`. */
  readonly userId: number | null;
}

/** Collects the standard output of a child process, bounded. */
function collectOutput(stream: NodeJS.ReadableStream | null): () => string {
  let output = "";
  stream?.setEncoding("utf8");
  stream?.on("data", (chunk: string) => {
    if (output.length < MAXIMUM_CHILD_OUTPUT) output += chunk;
  });
  return () => output;
}

function readUsage(output: string): FileSystemUsage | null {
  const numbers = output.trim().split(/\s+/u).map(Number);
  const [blockSize, blocks, freeBlocks, availableBlocks] = numbers;
  if (
    numbers.length !== 4 ||
    blockSize === undefined ||
    blocks === undefined ||
    freeBlocks === undefined ||
    availableBlocks === undefined ||
    !numbers.every((value) => Number.isSafeInteger(value) && value >= 0)
  )
    return null;
  return {
    size: blocks * blockSize,
    used: Math.max(0, blocks - freeBlocks) * blockSize,
    free: availableBlocks * blockSize,
  };
}

/**
 * Measures one file system with `stat --file-system` in a short-lived child.
 *
 * @remarks
 * `statfs` on a hanging network drive blocks the caller. In a child it blocks
 * neither the event loop nor a thread of Node's pool, and the caller decides
 * how long to wait.
 */
function probeFileSystem(mountPoint: string): FileSystemProbe {
  const child = spawn(
    "stat",
    ["--file-system", "--format=%S %b %f %a", "--", mountPoint],
    {
      env: { PATH: process.env.PATH, LC_ALL: "C" },
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  const output = collectOutput(child.stdout);
  const finished = new Promise<FileSystemUsage | null>((resolve) => {
    child.once("error", () => resolve(null));
    child.once("close", (code) =>
      resolve(code === 0 ? readUsage(output()) : null),
    );
  });
  return {
    finished,
    stop: () => {
      child.kill("SIGKILL");
    },
  };
}

/** Measures a directory tree with `du`, bounded in time; files it may not read count as missing. */
function measureDirectory(
  directory: string,
  timeoutMs: number,
): Promise<number | null> {
  const child = spawn(
    "du",
    ["--summarize", "--block-size=1", "--one-file-system", "--", directory],
    {
      env: { PATH: process.env.PATH, LC_ALL: "C" },
      stdio: ["ignore", "pipe", "ignore"],
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    },
  );
  const output = collectOutput(child.stdout);
  return new Promise((resolve) => {
    child.once("error", () => resolve(null));
    child.once("close", (exitCode, signal) => {
      // `du` exits with 1 when a subdirectory is unreadable but still prints the total.
      const total = Number(/^(\d+)\s/u.exec(output())?.[1]);
      resolve(signal === null && Number.isSafeInteger(total) ? total : null);
    });
  });
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    // A missing source is an expected state of the server, shown as "—".
    return null;
  }
}

async function listDirectory(path: string): Promise<readonly string[]> {
  try {
    return await readdir(path);
  } catch {
    // Without the directory there is nothing to choose from.
    return [];
  }
}

/** Creates the readers of the running server. */
export function createServerSystemSources(): SystemSources {
  return {
    readText,
    listDirectory,
    probeFileSystem,
    measureDirectory,
    now: () => Date.now(),
    userId: process.getuid?.() ?? null,
  };
}
