import { readPicaWrite } from "./PicaToolSchemas";

import type { PicaWriteTool } from "./PicaToolSchemas";

function fingerprint(
  tool: PicaWriteTool,
  parameters: Readonly<Record<string, string>>,
): string {
  return JSON.stringify([
    tool,
    ...Object.entries(parameters).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  ]);
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
    input: Readonly<Record<string, string>>,
  ): boolean {
    return this.permitted.delete(fingerprint(tool, input));
  }

  private readLine(line: string): void {
    const match =
      /^(?:BESTÄTIGEN|CONFIRM) (tickets_set_title|tickets_set_status) (\{.*\})$/u.exec(
        line,
      );
    if (!match) return;
    const tool = match[1];
    if (tool !== "tickets_set_title" && tool !== "tickets_set_status") return;
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
