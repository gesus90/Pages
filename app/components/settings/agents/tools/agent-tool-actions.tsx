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
  "antigravity_acp",
  "playwright_mcp",
  "chromium",
  "firefox",
];

/** Offers only fixed operations; active-process protection is also enforced by the service. */
export function AgentToolActions({
  tool,
  isPending,
}: {
  readonly tool: AgentToolView;
  readonly isPending: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const actions = INSTALLABLE.includes(tool.id)
    ? [...CHECK_ACTIONS, ...MANAGED_ACTIONS]
    : CHECK_ACTIONS;
  return (
    <>
      {actions.map((action) => (
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
          {t(`agentTools.actions.${action}`)}
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
