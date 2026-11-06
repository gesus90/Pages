import {
  isCurrentLocalStateAudience,
  isLocalStateAudience,
} from "@/app/lib/local-state/local-state-audience";
import { readRouteData } from "@/app/lib/local-state/route-data";

import type { LocalStateRouteKind } from "@/app/components/common/use-local-state-route";
import type { WikiShellData } from "@/app/routes/wiki";

/** The rights-checked endpoint of the wiki frame; the key of its kept answers as well. */
export const WIKI_SHELL_ENDPOINT = "/wiki-api/navigation";

function isWikiShellData(value: unknown): value is WikiShellData {
  return (
    typeof value === "object" &&
    value !== null &&
    "navigation" in value &&
    typeof value.navigation === "object" &&
    value.navigation !== null &&
    "people" in value &&
    Array.isArray(value.people) &&
    "templates" in value &&
    Array.isArray(value.templates) &&
    "today" in value &&
    typeof value.today === "string" &&
    "audience" in value &&
    isLocalStateAudience(value.audience)
  );
}

/** The page tree, templates and people of the wiki, kept per account and rights. */
export const WIKI_SHELL_STATE: LocalStateRouteKind<WikiShellData> = {
  schemaVersion: 1,
  isPayload: isWikiShellData,
  isCurrent: (shell) => isCurrentLocalStateAudience(shell.audience),
  ownerOf: (shell) => shell.audience.userId,
  isRefused: () => false,
};

/**
 * Reads the wiki frame of the signed-in account from its endpoint.
 *
 * @param signal - Ends the request when it is no longer needed.
 */
export function readWikiShell(signal: AbortSignal): Promise<WikiShellData> {
  return readRouteData({
    endpoint: WIKI_SHELL_ENDPOINT,
    signal,
    isPayload: isWikiShellData,
  });
}
