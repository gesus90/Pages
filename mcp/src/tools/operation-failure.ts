import type {
  AgentLimitDetails,
  AgentOperationDetails,
  AgentProjectCandidates,
  AgentRejectionReason,
} from "../../../definition/PagesAgentOperations.js";

const LIMIT_CONSTRAINTS = [
  "wikiContentBytes",
  "requestBytes",
  "responseBytes",
  "importIndexEntries",
  "importFiles",
  "importFileBytes",
  "importContentBytes",
  "importPathBytes",
  "importSources",
  "importLinks",
  "importAssets",
] as const satisfies readonly AgentLimitDetails["constraint"][];

/** Every reason of the contract, so a new one cannot be left out of the whitelist unnoticed. */
const REJECTION_REASONS: Readonly<
  Record<AgentRejectionReason["reason"], true>
> = {
  model_unavailable: true,
  reasoning_unsupported: true,
  reasoning_required: true,
  default_model_unavailable: true,
  sharing_target_unavailable: true,
  configuration_invalid: true,
  credentials_in_text: true,
  parameter_reference_unavailable: true,
  agent_limit_reached: true,
  agent_running: true,
  sharing_changes_required: true,
};

function isRejectionReason(
  input: unknown,
): input is AgentRejectionReason["reason"] {
  return typeof input === "string" && Object.hasOwn(REJECTION_REASONS, input);
}

/** Whitelisted business errors; provider diagnostics and submitted credentials are discarded. */
export class PagesOperationFailure extends Error {
  public readonly code:
    | "NOT_FOUND"
    | "AMBIGUOUS"
    | "INVALID_REQUEST"
    | "PAYLOAD_TOO_LARGE"
    | "CONFLICT"
    | "FORBIDDEN"
    | "CONFIRMATION_REQUIRED";
  public readonly details: AgentOperationDetails | undefined;

  public constructor(
    code: PagesOperationFailure["code"],
    details?: AgentOperationDetails,
  ) {
    super(
      code === "NOT_FOUND"
        ? "Not found or no access."
        : "The agent API request was rejected.",
    );
    this.code = code;
    this.details = details;
  }
}

function readLimit(input: unknown): AgentLimitDetails | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return undefined;
  const fields = input as Record<string, unknown>;
  const constraint = LIMIT_CONSTRAINTS.find(
    (name) => name === fields.constraint,
  );
  if (
    !constraint ||
    typeof fields.limit !== "number" ||
    !Number.isSafeInteger(fields.limit) ||
    fields.limit <= 0
  )
    return undefined;
  return { constraint, limit: fields.limit };
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

function readRevision(
  input: unknown,
): { readonly currentRevision: number } | undefined {
  if (
    typeof input !== "object" ||
    input === null ||
    !("currentRevision" in input) ||
    typeof input.currentRevision !== "number" ||
    !Number.isSafeInteger(input.currentRevision) ||
    input.currentRevision < 1
  )
    return undefined;
  return { currentRevision: input.currentRevision };
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
  const publicCode = (
    [
      "NOT_FOUND",
      "INVALID_REQUEST",
      "PAYLOAD_TOO_LARGE",
      "CONFLICT",
      "FORBIDDEN",
      "CONFIRMATION_REQUIRED",
    ] as const
  ).find((code) => code === error.code);
  if (publicCode) {
    const expectedStatus = {
      NOT_FOUND: 404,
      INVALID_REQUEST: 400,
      PAYLOAD_TOO_LARGE: 413,
      CONFLICT: 409,
      FORBIDDEN: 403,
      CONFIRMATION_REQUIRED: 400,
    }[publicCode];
    const details = failureDetails(publicCode, error.details);
    return response.status === expectedStatus
      ? new PagesOperationFailure(publicCode, details)
      : undefined;
  }
  return undefined;
}

function readReason(input: unknown): AgentRejectionReason | undefined {
  if (typeof input !== "object" || input === null || !("reason" in input))
    return undefined;
  return isRejectionReason(input.reason) ? { reason: input.reason } : undefined;
}

function failureDetails(
  code: PagesOperationFailure["code"],
  details: unknown,
): AgentOperationDetails | undefined {
  if (code === "PAYLOAD_TOO_LARGE") return readLimit(details);
  if (code === "CONFLICT") return readRevision(details) ?? readReason(details);
  if (code === "INVALID_REQUEST" || code === "FORBIDDEN")
    return readReason(details);
  return undefined;
}
