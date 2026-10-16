const MESSAGE_CHARACTERS = 160;

function readCode(error: Error): string | null {
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" || typeof code === "number"
    ? String(code)
    : null;
}

function readPath(error: Error): string | null {
  const path: unknown = Reflect.get(error, "path");
  return typeof path === "string" &&
    typeof Reflect.get(error, "syscall") === "string"
    ? path
    : null;
}

/**
 * Describes an error for a server log without the content it may carry.
 *
 * @param error - The caught value.
 * @returns The kind, the code, the first line of the message with every quoted
 * part left out and, for a system call, the path it failed on.
 *
 * @remarks
 * A parser or the database may quote the text it failed on, so quoted parts
 * never reach the log; the path of a failed system call is a server path.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const message = (error.message.split("\n")[0] ?? "")
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/gu, "…")
    .slice(0, MESSAGE_CHARACTERS);
  const code = readCode(error);
  // A coded error of Pages may carry only its code as message.
  const parts = [error.name, code, message === code ? null : message];
  return [...parts, readPath(error)]
    .filter((part) => part !== null && part !== "")
    .join(" | ");
}
