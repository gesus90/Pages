import { useTranslation } from "react-i18next";

import { agentToolTargetVersion } from "../agent-tool-actions";

import type { AgentToolView } from "@/definition/AgentTools";

/** Update states that report a problem rather than a result. */
const PROBLEM_STATES: ReadonlySet<string> = new Set([
  "check_failed",
  "source_unreachable",
  "incompatible",
]);

// New sessions start the active version; a browser row names the browser's own version.
function shownVersion(tool: AgentToolView): string {
  const version =
    tool.kind === "browser"
      ? tool.installedVersion
      : (tool.activeVersion ?? tool.installedVersion);
  return version ?? "—";
}

// While an update runs, the version names the release it moves to.
function versionLine(tool: AgentToolView): string {
  const target = agentToolTargetVersion(tool);
  const isUpdating =
    tool.operation?.state === "running" && tool.operation.action === "update";
  return isUpdating && target !== null
    ? `${shownVersion(tool)} → ${target}`
    : shownVersion(tool);
}

function ReleaseNote({
  tool,
}: {
  readonly tool: AgentToolView;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const version = agentToolTargetVersion(tool);
  if (tool.operation?.state === "running") return null;
  if (PROBLEM_STATES.has(tool.release.state))
    return (
      <p className="truncate text-xs text-destructive">
        {t(`agentTools.release.state.${tool.release.state}`)}
      </p>
    );
  if (!tool.update.isNewer || version === null) return null;
  return (
    <p className="truncate text-xs font-semibold text-primary">
      {t("agentTools.update.available", { version })}
    </p>
  );
}

/**
 * The version column of a tool row with the release an update installs below it.
 * @remarks
 * A failed or unreachable update search is named as such and never reads as
 * current; while an update runs the line shows the old and the new version.
 */
export function AgentToolVersion({
  tool,
}: {
  readonly tool: AgentToolView;
}): React.ReactElement {
  const line = versionLine(tool);
  return (
    <div className="pointer-events-none relative min-w-0">
      <p className="truncate text-sm text-foreground">{line}</p>
      <ReleaseNote tool={tool} />
    </div>
  );
}
