/** Redacts credential-shaped strings from final answers before persistence, display or result forwarding. */
export function sanitizePlanOutput(output: string): string {
  return output
    .slice(0, 200000)
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
