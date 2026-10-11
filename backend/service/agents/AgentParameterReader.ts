import { AgentOperationError } from "@/backend/error/AgentOperationError";

const MAXIMUM_IDENTIFIER_LENGTH = 200;

/**
 * Reads the parameters of an operation as a plain object.
 *
 * @param input - The raw parameters.
 * @returns The object.
 * @throws {AgentOperationError} `INVALID_REQUEST` for anything but an object.
 */
export function readParameterRecord(
  input: unknown,
): Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentOperationError("INVALID_REQUEST");
  return input as Record<string, unknown>;
}

/**
 * Reads an identifier-like parameter.
 *
 * @param input - The raw value.
 * @returns The value, unchanged.
 * @throws {AgentOperationError} `INVALID_REQUEST` for an empty or overlong text.
 */
export function readIdentifier(input: unknown): string {
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.length > MAXIMUM_IDENTIFIER_LENGTH
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}

/**
 * Requires that exactly the named parameters are present.
 *
 * @param fields - The parameters of the call.
 * @param keys - The parameter names the operation takes.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing or unknown parameter.
 */
export function requireParameterKeys(
  fields: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): void {
  if (
    Object.keys(fields).length !== keys.length ||
    keys.some((key) => !(key in fields))
  )
    throw new AgentOperationError("INVALID_REQUEST");
}
