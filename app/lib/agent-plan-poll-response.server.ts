import { createHash } from "node:crypto";

import { AGENT_NO_STORE } from "./settings-actions/settings-agents-response.server";

function stablePollingField(key: string, contents: unknown): unknown {
  if (
    key === "progress" &&
    contents !== null &&
    typeof contents === "object" &&
    "observedAt" in contents
  )
    // Reading a diagnostic projection must not invalidate otherwise unchanged progress.
    return { ...contents, observedAt: null };
  return contents;
}

/** Identifies meaningful public changes, excluding a diagnostic read's own observation time. */
export function planPollingEtag(result: unknown): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(result, stablePollingField))
    .digest("hex");
  return `W/"${digest}"`;
}

/** Suppresses unchanged public snapshots after authorization, while opening always reads the full state. */
export function planPollingResponse(
  request: Request,
  result: unknown,
): Response {
  const body = JSON.stringify(result);
  const etag = planPollingEtag(result);
  const headers = { ...AGENT_NO_STORE, ETag: etag };
  return request.headers.get("If-None-Match") === etag
    ? new Response(null, { status: 304, headers })
    : new Response(body, {
        headers: {
          ...headers,
          "Content-Type": "application/json; charset=utf-8",
        },
      });
}
