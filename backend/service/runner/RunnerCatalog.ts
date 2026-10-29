import { supportsRunnerAntigravity } from "./RunnerOutputCapabilities";
import type { RunnerCatalog } from "@/definition/RunnerProtocol";
import type { RunnerMessage } from "@/definition/RunnerProtocol";

const MAXIMUM_CATALOG_AGE_MILLISECONDS = 600_000;

/** Rejects late inventory generations and retains known profiles after incomplete probes. */
export function mergeRunnerCatalog(
  previous: RunnerCatalog | undefined,
  message: Extract<RunnerMessage, { type: "reconcile" | "catalog" }>,
): RunnerCatalog | undefined {
  const incoming = message.catalog;
  // A runner without the 1.10 contract keeps the last inventory, which is then never current.
  if (!incoming)
    return previous ? { ...previous, isComplete: false } : undefined;
  // Messages of one channel arrive in order; an older or repeated generation is a replay.
  if (previous && incoming.generation <= previous.generation) return previous;
  return withRetainedProfiles(previous, incoming);
}

/** Profiles a newer report omits stay visible: removed after a complete probe, unknown otherwise. */
function withRetainedProfiles(
  previous: RunnerCatalog | undefined,
  incoming: RunnerCatalog,
): RunnerCatalog {
  const retained = (previous?.interpreters ?? []).filter(
    (profile) =>
      !incoming.interpreters.some((entry) => entry.id === profile.id),
  );
  return {
    ...incoming,
    interpreters: [...incoming.interpreters, ...retained],
    tools: incoming.areToolsComplete
      ? incoming.tools
      : (previous?.tools ?? incoming.tools),
    removedInterpreterIds: incoming.isComplete
      ? retained.map((profile) => profile.id)
      : (previous?.removedInterpreterIds ?? []),
  };
}

/** A retained inventory explains offline choices but never authorizes a stale start. */
export function isRunnerCatalogCurrent(
  catalog: RunnerCatalog | undefined,
): boolean {
  if (!catalog?.isComplete) return false;
  const age = Date.now() - Date.parse(catalog.checkedAt);
  return age >= -30_000 && age < MAXIMUM_CATALOG_AGE_MILLISECONDS;
}

/** Retained inventory from a newer runner cannot authorize Antigravity after a downgrade. */
export function compatibleRunnerCatalog(
  catalog: RunnerCatalog | undefined,
  version: string | undefined,
): RunnerCatalog | undefined {
  if (!catalog || supportsRunnerAntigravity(version)) return catalog;
  return {
    ...catalog,
    tools: catalog.tools.map((tool) =>
      tool.tool === "antigravity"
        ? { ...tool, acp: { status: "incompatible", reason: "probe_failed" } }
        : tool,
    ),
  };
}
