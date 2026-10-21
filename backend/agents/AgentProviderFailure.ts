import { readAgentObject } from "./AgentPayload";
import { classifyOpenCodeFailure } from "./acp/OpenCodeAcpErrors";
import {
  diagnosticProviderReset,
  structuredProviderReset,
} from "./providers/ProviderReset";

import type {
  AgentProviderFailure,
  AgentPlanRetryCode,
} from "@/definition/AgentPlanRetry";

const CODEX_FAILURES: Readonly<Record<string, AgentPlanRetryCode>> = {
  usageLimitExceeded: "provider_quota_exhausted",
  rateLimitExceeded: "provider_rate_limited",
  serverOverloaded: "provider_unavailable",
  httpConnectionFailed: "provider_unreachable",
  responseStreamConnectionFailed: "provider_unreachable",
  responseStreamDisconnected: "provider_unreachable",
};

function codexFailure(
  details: Record<string, unknown>,
): AgentPlanRetryCode | null {
  const info = details.codexErrorInfo;
  const keys =
    typeof info === "string" ? [info] : Object.keys(readAgentObject(info));
  for (const key of keys) {
    if (Object.hasOwn(CODEX_FAILURES, key)) return CODEX_FAILURES[key];
  }
  return null;
}

/** Narrows the small set of provider failures that the plan retry policy understands. */
export function isPlanRetryCode(code: unknown): code is AgentPlanRetryCode {
  return (
    code === "provider_unreachable" ||
    code === "provider_unavailable" ||
    code === "provider_rate_limited" ||
    code === "provider_quota_exhausted"
  );
}

/** Classifies only error diagnostics, never ordinary model output. */
export function diagnosticProviderFailure(
  error: unknown,
): AgentProviderFailure | null {
  const record = readAgentObject(error);
  const details = readAgentObject(record.data);
  const message = error instanceof Error ? error.message : "";
  const encoded = `${message}\n${JSON.stringify(details)}`;
  const code = codexFailure(details) ?? classifyOpenCodeFailure(encoded);
  if (!isPlanRetryCode(code)) return null;
  return {
    code,
    resetAt:
      structuredProviderReset(details) ?? diagnosticProviderReset(encoded),
  };
}

/** Claude's rejected subscription window is explicit; warnings and missing budget data are not exhaustion. */
export function acpProviderFailure(meta: unknown): AgentProviderFailure | null {
  const root = readAgentObject(meta);
  const limit = readAgentObject(root["_claude/rateLimit"]);
  if (limit.status === "rejected")
    return {
      code: "provider_quota_exhausted",
      resetAt: structuredProviderReset(limit),
    };
  return null;
}
