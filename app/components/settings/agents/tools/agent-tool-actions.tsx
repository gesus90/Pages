import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { AgentToolAction, AgentToolView } from "@/definition/AgentTools";

const CHECK_ACTIONS: readonly AgentToolAction[] = ["check", "test"];
const MANAGED_ACTIONS: readonly AgentToolAction[] = [
  "install",
  "update",
  "repair",
  "rollback",
  "remove",
];
// Pages installs its own runtime generation next to the external one; it never installs or repairs the host's.
const RUNTIME_ACTIONS: readonly AgentToolAction[] = [
  "update",
  "rollback",
  "remove",
];
const RUNTIMES = ["node", "python"];
const INSTALLABLE = [
  "codex",
  "claude",
  "opencode",
  "codex_acp",
  "claude_acp",
  "antigravity_acp",
  "playwright_mcp",
  "chromium",
  "firefox",
];
// Tools that connections start; re-binding checks those connections again.
const CONNECTION_TOOLS = [
  "codex",
  "claude",
  "opencode",
  "codex_acp",
  "claude_acp",
  "antigravity_acp",
];

function managedActions(tool: AgentToolView): readonly AgentToolAction[] {
  if (INSTALLABLE.includes(tool.id)) return MANAGED_ACTIONS;
  return RUNTIMES.includes(tool.id) ? RUNTIME_ACTIONS : [];
}

function actionsOf(tool: AgentToolView): readonly AgentToolAction[] {
  const actions = [...CHECK_ACTIONS, ...managedActions(tool)];
  return CONNECTION_TOOLS.includes(tool.id) ? [...actions, "rebind"] : actions;
}

/** The checked release of this tool that "Aktualisieren" installs, if it moves. */
function ownTargetVersion(tool: AgentToolView): string | null {
  return (
    tool.update.targetVersions.find((entry) => entry.id === tool.id)?.version ??
    null
  );
}

// An update needs a checked newer target and no running operation; the server checks both again.
function isActionDisabled(
  tool: AgentToolView,
  action: AgentToolAction,
  isPending: boolean,
): boolean {
  if (isPending) return true;
  if (action === "update")
    return tool.update.target === null || !tool.update.isNewer;
  if (
    (action === "remove" || action === "rollback") &&
    tool.source !== "managed"
  )
    return true;
  return action === "remove" && tool.activities.length > 0;
}

// An external installation stays untouched; installing creates Pages' own managed one.
function ActionLabel({
  tool,
  action,
}: {
  readonly tool: AgentToolView;
  readonly action: AgentToolAction;
}): React.ReactElement {
  const { t } = useTranslation();
  const version = ownTargetVersion(tool);
  if (action === "update" && version !== null && tool.update.isNewer)
    return <>{t("agentTools.update.updateTo", { version })}</>;
  return (
    <>
      {t(
        action === "install" && tool.source === "system"
          ? "agentTools.actions.installManaged"
          : `agentTools.actions.${action}`,
      )}
    </>
  );
}

/**
 * Offers only fixed operations; rights, serialization and active-process protection are enforced by the service.
 * @remarks
 * "Aktualisieren" names the checked target version; the form around it
 * sends the combination's target, which the server compares before it
 * starts anything.
 */
export function AgentToolActions({
  tool,
  isPending,
}: {
  readonly tool: AgentToolView;
  readonly isPending: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      {actionsOf(tool).map((action) => (
        <Button
          key={action}
          type="submit"
          name="intent"
          value={action}
          size="sm"
          variant={action === "remove" ? "destructive-soft" : "outline"}
          disabled={isActionDisabled(tool, action, isPending)}
        >
          <ActionLabel tool={tool} action={action} />
        </Button>
      ))}
      {tool.id === "playwright_mcp" || tool.id === "firefox" ? (
        <Button
          type="submit"
          name="intent"
          value={tool.enabled ? "disable" : "enable"}
          size="sm"
          variant="outline"
          disabled={isPending}
        >
          {t(
            tool.enabled
              ? "agentTools.actions.disable"
              : "agentTools.actions.enable",
          )}
        </Button>
      ) : null}
    </>
  );
}
