/** Narrows an untrusted JSON object without assuming any provider-specific fields. */
export function readAgentObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
