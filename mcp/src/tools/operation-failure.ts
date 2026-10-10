import type { AgentProjectCandidates } from "../../../definition/PagesAgentOperations.js";

/** Whitelisted business errors; provider diagnostics and submitted credentials are discarded. */
export class PagesOperationFailure extends Error {
  public readonly code:
    "NOT_FOUND" | "AMBIGUOUS" | "INVALID_REQUEST" | "PAYLOAD_TOO_LARGE";
  public readonly details: AgentProjectCandidates | undefined;

  public constructor(
    code: PagesOperationFailure["code"],
    details?: AgentProjectCandidates,
  ) {
    super("The agent API request was rejected.");
    this.code = code;
    this.details = details;
  }
}

function readCandidates(input: unknown): AgentProjectCandidates | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const details = input as Record<string, unknown>;
  if (
    !Array.isArray(details.candidates) ||
    details.candidates.length > 100 ||
    typeof details.truncated !== "boolean"
  )
    return undefined;
  const candidates: { id: string; name: string }[] = [];
  for (const entry of details.candidates) {
    if (typeof entry !== "object" || entry === null) return undefined;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.id !== "string" || typeof candidate.name !== "string")
      return undefined;
    candidates.push({ id: candidate.id, name: candidate.name });
  }
  return { candidates, truncated: details.truncated };
}

/** Parses only public business codes and visible choices; authentication failures stay generic. */
export async function operationFailure(
  response: Response,
): Promise<PagesOperationFailure | undefined> {
  let input: unknown;
  try {
    input = await response.json();
  } catch {
    return undefined;
  }
  if (typeof input !== "object" || input === null) return undefined;
  const envelope = input as Record<string, unknown>;
  if (
    envelope.apiVersion !== "1" ||
    typeof envelope.error !== "object" ||
    envelope.error === null
  )
    return undefined;
  const error = envelope.error as Record<string, unknown>;
  if (error.code === "AMBIGUOUS" && response.status === 409) {
    const details = readCandidates(error.details);
    return details
      ? new PagesOperationFailure("AMBIGUOUS", details)
      : undefined;
  }
  if (
    error.code === "NOT_FOUND" ||
    error.code === "INVALID_REQUEST" ||
    error.code === "PAYLOAD_TOO_LARGE"
  ) {
    const expectedStatus = {
      NOT_FOUND: 404,
      INVALID_REQUEST: 400,
      PAYLOAD_TOO_LARGE: 413,
    }[error.code];
    return response.status === expectedStatus
      ? new PagesOperationFailure(error.code)
      : undefined;
  }
  return undefined;
}
