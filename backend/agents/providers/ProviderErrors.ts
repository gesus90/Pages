import { readAgentObject } from "@/backend/agents/AgentPayload";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";

const AUTH_CODES = new Set([
  "401",
  "API_KEY_INVALID",
  "1000",
  "1001",
  "1002",
  "1003",
  "1004",
  "1005",
]);
const QUOTA_CODES = new Set([
  "402",
  "insufficient_quota",
  "billing_error",
  "billing_hard_limit_reached",
  "billing_not_active",
  "1113",
]);
const PERMISSION_CODES = new Set(["403", "1220"]);
const MODEL_CODES = new Set(["404", "model_not_found", "1211"]);
const RATE_CODES = new Set(["429", "1302", "1305"]);
const UNAVAILABLE_CODES = new Set(["500", "502", "503", "504", "529"]);

function readCodes(payload: unknown): string[] {
  const error = readAgentObject(readAgentObject(payload).error);
  const fields: unknown[] = [error.code, error.type, error.status];
  if (Array.isArray(error.details))
    fields.push(
      ...error.details.map((entry: unknown) => readAgentObject(entry).reason),
    );
  return fields
    .filter(
      (value): value is string | number =>
        typeof value === "string" || typeof value === "number",
    )
    .map(String);
}

/** Maps HTTP and structured provider error codes; upstream message text is ignored. */
export function classifyProviderError(
  status: number,
  payload: unknown,
): AgentErrorCode | null {
  const codes = [String(status), ...readCodes(payload)];
  const classifications: readonly [ReadonlySet<string>, AgentErrorCode][] = [
    [AUTH_CODES, "provider_auth_failed"],
    [QUOTA_CODES, "provider_quota_exhausted"],
    [PERMISSION_CODES, "provider_permission_denied"],
    [MODEL_CODES, "provider_model_not_found"],
    [RATE_CODES, "provider_rate_limited"],
    [UNAVAILABLE_CODES, "provider_unavailable"],
  ];
  for (const [accepted, code] of classifications) {
    if (codes.some((value) => accepted.has(value))) return code;
  }
  if (status >= 500) return "provider_unavailable";
  if (status >= 400 || codes.includes("400"))
    return "provider_request_rejected";
  if (
    status < 200 ||
    status >= 300 ||
    Object.hasOwn(readAgentObject(payload), "error")
  )
    return "provider_bad_response";
  return null;
}
