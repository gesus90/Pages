import { writeSync } from "node:fs";

/** Last-resort output of already sanitized JSONL; never calls the logger recursively. */
export function writeLogFallback(line: string): void {
  try {
    writeSync(2, line);
  } catch {
    // No remaining output channel; the writer's loss counter still records it.
  }
}

/** Extracts only an OS-style code, never an I/O message containing paths or payloads. */
export function loggingFailureCode(error: unknown): string {
  try {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string" &&
      /^[A-Z_0-9]+$/u.test(error.code)
    )
      return error.code;
  } catch {
    return "LOG_IO_ERROR";
  }
  return "LOG_IO_ERROR";
}
