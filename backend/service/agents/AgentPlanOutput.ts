import { redactCredentials } from "@/backend/security/AgentTextSafety";

/** Longest text a run keeps, whatever its source. */
export const PLAN_OUTPUT_LIMIT = 200_000;

/** Redacts credential-shaped strings from final answers before persistence, display or result forwarding. */
export function sanitizePlanOutput(output: string): string {
  return output
    .slice(0, PLAN_OUTPUT_LIMIT)
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gu,
      "[redacted]",
    )
    .replace(
      /\b(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9]{12,}|github_pat_[a-zA-Z0-9_]{12,}|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)\b/gu,
      "[redacted]",
    )
    .replace(
      /((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|authorization)["']?\s*[=:]\s*["']?)(?:Bearer\s+)?[^\s,;"'}]+/giu,
      "$1[redacted]",
    )
    .replace(/\bBearer\s+[a-zA-Z0-9_.~+/=-]+/giu, "Bearer [redacted]");
}

/**
 * Prepares text for a file that stays on disk: credential-shaped text is masked
 * and a cut at the length limit says so.
 *
 * @param text - Prompt, result or definition text.
 * @returns The masked text, with a note when it was shortened.
 */
export function sanitizeArtifactText(text: string): string {
  const masked = sanitizePlanOutput(redactCredentials(text));
  return text.length > PLAN_OUTPUT_LIMIT ? `${masked}\n[truncated]` : masked;
}
