import { isPicaWriteTool, readPicaWrite } from "./PicaToolSchemas";

import type { PicaWriteTool } from "./PicaToolSchemas";

const CONFIRMATION_LINE = /^(?:BESTÄTIGEN|CONFIRM) ([a-z_]+) (\{.*\})$/u;

/** The same value with the keys of every object sorted, so field order never matters. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([key, entry]) => [key, canonical(entry)]),
  );
}

function fingerprint(
  tool: PicaWriteTool,
  parameters: Readonly<Record<string, unknown>>,
): string {
  return JSON.stringify([tool, canonical(parameters)]);
}

/** Invocation-local capabilities obtained exclusively from explicit lines in the current human message. */
export class PicaWriteConfirmation {
  private readonly permitted = new Set<string>();

  public constructor(message: string) {
    this.add(message);
  }

  /** Adds the lines of another human message of the same turn, such as a steer. */
  public add(message: string): void {
    for (const line of message.split(/\r?\n/u)) this.readLine(line);
  }

  /** Consumes an exact target, old value and new value synchronously, before any asynchronous write. */
  public consume(
    tool: PicaWriteTool,
    input: Readonly<Record<string, unknown>>,
  ): boolean {
    return this.permitted.delete(fingerprint(tool, input));
  }

  private readLine(line: string): void {
    const match = CONFIRMATION_LINE.exec(line);
    if (!match) return;
    const tool = match[1];
    if (!isPicaWriteTool(tool)) return;
    try {
      const input: unknown = JSON.parse(match[2]);
      const parameters = readPicaWrite(tool, input);
      if (parameters) this.permitted.add(fingerprint(tool, parameters));
    } catch {
      // Malformed confirmation text grants no capability.
      return;
    }
  }
}
