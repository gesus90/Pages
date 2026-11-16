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

function actionsOf(tool: AgentToolView): readonly AgentToolAction[] {
  const actions = INSTALLABLE.includes(tool.id)
    ? [...CHECK_ACTIONS, ...MANAGED_ACTIONS]
    : [...CHECK_ACTIONS];
  return CONNECTION_TOOLS.includes(tool.id) ? [...actions, "rebind"] : actions;
}

// An external installation stays untouched; installing creates Pages' own managed one.
function actionLabel(tool: AgentToolView, action: AgentToolAction): string {
  return action === "install" && tool.source === "system"
    ? "agentTools.actions.installManaged"
    : `agentTools.actions.${action}`;
}

/** Offers only fixed operations; rights, serialization and active-process protection are enforced by the service. */
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
          disabled={
            isPending ||
            ((action === "remove" || action === "rollback") &&
              tool.source !== "managed") ||
            (action === "remove" && tool.activities.length > 0)
          }
        >
          {t(actionLabel(tool, action))}
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
