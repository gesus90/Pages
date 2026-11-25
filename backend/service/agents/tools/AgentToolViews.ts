import { AgentAccessDeniedError } from "@/backend/error/AgentErrors";

import { isAgentToolInstallable, pairedCli } from "./AgentToolRegistry";

import type {
  AgentToolActivity,
  AgentToolConnectionView,
  AgentToolDiagnostic,
  AgentToolId,
  AgentToolOperationView,
  AgentToolReleaseView,
  AgentToolUpdateView,
  AgentToolView,
} from "@/definition/AgentTools";
import type { AgentToolDefinition } from "./AgentToolRegistry";
import type { AgentToolHealth, AgentToolLocation } from "./AgentToolContracts";

/** The cached facts of one tool; building the view never executes a program. */
export interface AgentToolViewFacts {
  readonly tool: AgentToolDefinition;
  readonly enabled: boolean;
  readonly location: AgentToolLocation | null;
  readonly health: AgentToolHealth;
  readonly dependency: AgentToolId | null;
  readonly checkedAt: string | null;
  readonly lastSuccessfulCheck: string | null;
  readonly release: AgentToolReleaseView;
  readonly update: AgentToolUpdateView;
  readonly operation: AgentToolOperationView | null;
  readonly connections: readonly AgentToolConnectionView[];
  readonly activities: readonly AgentToolActivity[];
  readonly authentication: readonly {
    readonly connectionId: string;
    readonly isReady: boolean;
  }[];
}

function supportedVersions(tool: AgentToolDefinition): readonly string[] {
  if (tool.minimumVersion !== null) return [`≥ ${tool.minimumVersion}`];
  return tool.version === null ? [] : [tool.version];
}

function pairedTool(tool: AgentToolDefinition): AgentToolId | null {
  if (tool.adapter) return tool.adapter;
  const cli = pairedCli(tool);
  return cli.id === tool.id ? null : cli.id;
}

function locationFacts(
  location: AgentToolLocation | null,
): Pick<
  AgentToolView,
  "source" | "executable" | "rollbackRelease" | "terminalEntry"
> {
  return {
    source: location?.source ?? null,
    executable: location?.file ?? null,
    rollbackRelease: location?.previousRelease ?? null,
    terminalEntry: location?.terminalEntry ?? null,
  };
}

// A ready tool whose every connection lost its sign-in needs a login, not a repair.
function statusFacts(
  health: AgentToolHealth,
  authentication: AgentToolViewFacts["authentication"],
): Pick<AgentToolView, "status" | "diagnostic"> {
  const needsLogin =
    health.status === "ready" &&
    authentication.length > 0 &&
    authentication.every((check) => !check.isReady);
  return needsLogin
    ? {
        status: "authentication_required",
        diagnostic: "authentication_required",
      }
    : { status: health.status, diagnostic: health.diagnostic };
}

function versionFacts(
  facts: AgentToolViewFacts,
): Pick<
  AgentToolView,
  | "installedVersion"
  | "activeVersion"
  | "supportedVersions"
  | "approvedVersion"
  | "updateAvailable"
> {
  const { tool, location, health, release } = facts;
  const isBrowser = tool.kind === "browser";
  return {
    installedVersion: isBrowser
      ? (health.runtimeVersion ?? null)
      : health.version,
    activeVersion: isBrowser
      ? tool.version
      : (location?.version ?? health.version),
    supportedVersions: supportedVersions(tool),
    approvedVersion: release.targetVersion ?? tool.version,
    updateAvailable:
      isAgentToolInstallable(tool) && release.state === "update_available",
  };
}

/** Combines supervisor leases with live runner processes without duplicating a process ID. */
export function mergeAgentToolActivities(
  pinned: readonly AgentToolActivity[],
  processes: readonly AgentToolActivity[],
): readonly AgentToolActivity[] {
  return [
    ...pinned,
    ...processes.filter(
      (activity) =>
        !pinned.some((lease) => lease.processId === activity.processId),
    ),
  ];
}

/** Maps an unexpected tool failure into a safe fixed diagnostic code. */
export function agentToolFailureDiagnostic(
  error: unknown,
): AgentToolDiagnostic {
  if (error instanceof AgentAccessDeniedError) return "permission_denied";
  if (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EACCES" || error.code === "EPERM")
  )
    return "permission_denied";
  return "installation_failed";
}

/** Builds the secret-free operator view of one tool from its cached facts. */
export function agentToolView(facts: AgentToolViewFacts): AgentToolView {
  const { tool, location } = facts;
  return {
    id: tool.id,
    name: tool.name,
    kind: tool.kind,
    enabled: facts.enabled,
    ...statusFacts(facts.health, facts.authentication),
    dependency: facts.dependency,
    installed: facts.checkedAt === null ? null : location !== null,
    ...versionFacts(facts),
    update: facts.update,
    release: facts.release,
    pairedTool: pairedTool(tool),
    hasIntegratedAdapter: tool.hasIntegratedAdapter === true,
    operation: facts.operation,
    connections: facts.connections,
    lastSuccessfulCheck: facts.lastSuccessfulCheck,
    ...locationFacts(location),
    lastCheck: facts.checkedAt,
    activities: facts.activities,
    authentication: facts.authentication,
  };
}
