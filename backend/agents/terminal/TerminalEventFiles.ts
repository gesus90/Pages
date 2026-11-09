import { mkdir, open, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

import { logCaughtError } from "@/backend/logging/Logger";

/** Event files and transcripts are read this often. */
const POLL_MILLISECONDS = 250;

/** A transcript line longer than this is skipped; it holds a file the CLI read, not an event. */
const MAXIMUM_LINE = 4 * 1024 * 1024;

/** Reads one object of JSON text; anything else is `null`. */
export function readJsonObject(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

/** A parsed JSON value as an object; `null` for anything else. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

/** A nested object of a JSON object; `null` when it is missing. */
export function readObject(
  value: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null {
  return asRecord(value?.[key]);
}

/** A text field of a JSON object; `null` when it is missing. */
export function readString(
  value: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const entry = value?.[key];
  return typeof entry === "string" ? entry : null;
}

/** A count field of a JSON object; `null` when it is missing. */
export function readCount(
  value: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const entry = value?.[key];
  return typeof entry === "number" && Number.isFinite(entry) && entry >= 0
    ? entry
    : null;
}

/**
 * The quoted shell command a hook of a CLI runs to hand Pages one event.
 *
 * @param directory - The private event folder of the session.
 * @param source - Where the event text comes from: the standard input of a
 * hook or the first argument of a notification command.
 * @returns A command that writes the event to a new file and renames it only
 * when it is complete, so Pages never reads half an event.
 */
export function eventFileCommand(
  directory: string,
  source: "stdin" | "argument",
): string {
  const quoted = `'${directory.replaceAll("'", "'\\''")}'`;
  const write =
    source === "stdin" ? 'cat > "$f.part"' : 'printf %s "$1" > "$f.part"';
  return `f=${quoted}/$(date +%s%N)-$$; ${write} && mv "$f.part" "$f.json"`;
}

/**
 * The events the hooks of a CLI write into a private folder, in order.
 *
 * @remarks
 * Each hook writes one file whose name begins with the time in nanoseconds;
 * Pages reads them in that order and removes each after reading. The folder
 * lies in the private home of the session, which the CLI can reach, so an
 * event is evidence of what the CLI reported, not of what happened.
 */
export class TerminalEventDirectory {
  private readonly directory: string;
  private readonly onEvent: (event: Record<string, unknown>) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reading: Promise<void> = Promise.resolve();

  public constructor(
    directory: string,
    onEvent: (event: Record<string, unknown>) => void,
  ) {
    this.directory = directory;
    this.onEvent = onEvent;
  }

  /** Creates the folder and starts reading it. */
  public async start(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.timer = setInterval(() => {
      this.reading = this.reading.then(() => this.read());
    }, POLL_MILLISECONDS);
    this.timer.unref();
  }

  /** Reads what is left and stops. */
  public async stop(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    await this.reading;
    await this.read();
  }

  /** Removes the folder with every event left in it. */
  public async remove(): Promise<void> {
    await rm(this.directory, { recursive: true, force: true });
  }

  private async read(): Promise<void> {
    try {
      const names = (await readdir(this.directory))
        .filter((name) => name.endsWith(".json"))
        .sort();
      for (const name of names) {
        const file = path.join(this.directory, name);
        const event = readJsonObject(await readFile(file, "utf8"));
        await rm(file, { force: true });
        if (event) this.onEvent(event);
      }
    } catch (error: unknown) {
      logCaughtError("TerminalEventDirectory", error);
    }
  }
}

/**
 * Follows a JSON lines file a CLI appends to, such as its transcript.
 *
 * @remarks
 * Only complete lines are read; a line still being written waits for its
 * end. The file may appear late; until then nothing is read.
 */
export class JsonLinesTail {
  private readonly onLine: (line: Record<string, unknown>) => void;
  private file: string | null = null;
  private offset = 0;
  private pending = "";
  private decoder = new StringDecoder("utf8");
  private isSkippingExisting = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reading: Promise<void> = Promise.resolve();

  public constructor(onLine: (line: Record<string, unknown>) => void) {
    this.onLine = onLine;
  }

  /**
   * Starts following a file.
   *
   * @param file - The file the CLI appends to.
   * @param isFromEnd - Skips what the file holds already, such as the history of a resumed session.
   */
  public follow(file: string, isFromEnd = false): void {
    if (this.file === file) return;
    this.file = file;
    this.offset = 0;
    this.isSkippingExisting = isFromEnd;
    this.pending = "";
    this.decoder = new StringDecoder("utf8");
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.reading = this.reading.then(() => this.read());
    }, POLL_MILLISECONDS);
    this.timer.unref();
  }

  /** Reads the rest and stops. */
  public async stop(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    await this.reading;
    await this.read();
  }

  /** Reads what was appended since the last read. */
  public async read(): Promise<void> {
    const file = this.file;
    if (file === null) return;
    const handle = await open(file, "r").catch(() => null);
    if (handle === null) return;
    try {
      const { size } = await handle.stat();
      if (this.isSkippingExisting) {
        this.isSkippingExisting = false;
        this.offset = size;
      }
      if (size <= this.offset) return;
      const buffer = Buffer.alloc(Math.min(size - this.offset, MAXIMUM_LINE));
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.length,
        this.offset,
      );
      this.offset += bytesRead;
      this.pending += this.decoder.write(buffer.subarray(0, bytesRead));
      const lines = this.pending.split("\n");
      this.pending = (lines.pop() ?? "").slice(-MAXIMUM_LINE);
      for (const line of lines) {
        const parsed = readJsonObject(line);
        if (parsed) this.onLine(parsed);
      }
    } catch (error: unknown) {
      logCaughtError("JsonLinesTail", error);
    } finally {
      await handle.close();
    }
  }
}
