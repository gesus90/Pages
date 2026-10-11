import type { AgentImportIssue } from "@/definition/AgentImportManifest";

/** Checks portable relative Markdown keys without touching the filesystem or decoding URLs. */
export function isValidImportPath(sourceKey: string): boolean {
  if (
    !/\.md$/i.test(sourceKey) ||
    /[\\:%?#\u0000-\u001f\u007f]/u.test(sourceKey) ||
    sourceKey !== sourceKey.normalize("NFC")
  )
    return false;
  return sourceKey.split("/").every((segment) => {
    return (
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      segment.trim() === segment
    );
  });
}

/** Reports duplicate keys once each; duplicates are conflicts rather than silently deduplicated input. */
export function duplicateImportPaths(
  sourceKeys: readonly string[],
): AgentImportIssue[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const key of sourceKeys) {
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates].sort().map((sourceKey) => ({
    code: "CONFLICT",
    reason: "duplicate_source",
    sourceKeys: [sourceKey],
  }));
}
