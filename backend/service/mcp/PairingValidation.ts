import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

/** Normalizes the human code; invalid input remains indistinguishable from an unknown code. */
export function normalizePairingCode(input: unknown): string {
  if (typeof input !== "string" || input.length > 64) return "";
  const code = input.toUpperCase().replace(/[-\s]/g, "");
  return /^[BCDFGHJKLMNPQRSTVWXZ]{8}$/.test(code) ? code : "";
}

/** Validates untrusted client labels without reflecting their content in diagnostics. */
export function pairingText(input: unknown, maximum = 100): string {
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.trim().length > maximum ||
    /[\p{Cc}\p{Cf}]/u.test(input)
  )
    throw new McpAuthorizationError("invalid_request");
  return input.trim();
}

/** Accepts the current user preference: whole days 1–365, or zero for unlimited. */
export function pairingValidity(input: unknown): number {
  if (
    typeof input !== "number" ||
    !Number.isInteger(input) ||
    input < 0 ||
    input > 365
  )
    throw new McpAuthorizationError("invalid_request");
  return input;
}
