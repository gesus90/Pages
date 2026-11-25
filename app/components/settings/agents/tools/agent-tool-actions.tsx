import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/app/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

import type { AgentToolAction, AgentToolView } from "@/definition/AgentTools";

/** What a tool row can send: a fixed maintenance action or the switch of an optional integration. */
export type AgentToolIntent = AgentToolAction | "enable" | "disable";

/** The single action a row offers next to its menu. */
interface PrimaryAction {
  readonly intent: AgentToolAction;
  readonly labelKey: string;
  readonly variant: "default" | "outline";
}

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
// Optional integrations an administrator switches on and off.
const SWITCHABLE_TOOLS = ["playwright_mcp", "firefox"];
// The menu keeps one order for every tool: an action a tool does not offer stays in place, dimmed.
const MENU_ACTIONS: readonly AgentToolAction[] = [
  "check",
  "test",
  "repair",
  "rollback",
  "install",
  "rebind",
];
// Both change which installation new sessions start, so they ask first; an update starts at once.
const CONFIRMED_ACTIONS: readonly AgentToolIntent[] = ["remove", "rollback"];
const MENU_ITEM_CLASS = "min-h-9";

// A missing runtime has no version an update could compare, so Pages installs the searched release as its own.
function runtimeActions(tool: AgentToolView): readonly AgentToolAction[] {
  const hasSearchedRelease = tool.update.targetVersions.some(
    (entry) => entry.id === tool.id && entry.version !== null,
  );
  return tool.installed === false && hasSearchedRelease
    ? [...RUNTIME_ACTIONS, "install"]
    : RUNTIME_ACTIONS;
}

function managedActions(tool: AgentToolView): readonly AgentToolAction[] {
  if (INSTALLABLE.includes(tool.id)) return MANAGED_ACTIONS;
  return RUNTIMES.includes(tool.id) ? runtimeActions(tool) : [];
}

function actionsOf(tool: AgentToolView): readonly AgentToolAction[] {
  const actions = [...CHECK_ACTIONS, ...managedActions(tool)];
  return CONNECTION_TOOLS.includes(tool.id) ? [...actions, "rebind"] : actions;
}

/**
 * Whether an administrator switches this optional integration on and off.
 * @param tool - The tool of the row.
 */
export function isAgentToolSwitchable(tool: AgentToolView): boolean {
  return SWITCHABLE_TOOLS.includes(tool.id);
}

/**
 * The checked release of this tool that "Aktualisieren" installs, if it moves.
 * @param tool - The tool of the row.
 * @returns The target version, or `null` when this tool keeps its version.
 */
export function agentToolTargetVersion(tool: AgentToolView): string | null {
  return (
    tool.update.targetVersions.find((entry) => entry.id === tool.id)?.version ??
    null
  );
}

/**
 * Whether "Aktualisieren" can start for a tool now.
 * @param tool - The tool of the row.
 * @remarks
 * An update needs a checked target that is newer than the version new
 * sessions use; the server checks the target and running updates again.
 */
export function canUpdateAgentTool(tool: AgentToolView): boolean {
  return (
    actionsOf(tool).includes("update") &&
    tool.update.target !== null &&
    tool.update.isNewer
  );
}

function isActionDisabled(
  tool: AgentToolView,
  action: AgentToolAction,
  isPending: boolean,
): boolean {
  if (isPending || !actionsOf(tool).includes(action)) return true;
  if (action === "update") return !canUpdateAgentTool(tool);
  if (
    (action === "remove" || action === "rollback") &&
    tool.source !== "managed"
  )
    return true;
  return action === "remove" && tool.activities.length > 0;
}

// A failed operation is repeated first, then an update, then the installation of a missing tool.
function primaryActionOf(tool: AgentToolView): PrimaryAction | null {
  const { operation } = tool;
  if (operation?.state === "running") return null;
  if (operation?.state === "failed" && operation.retryAction)
    return {
      intent: operation.retryAction,
      labelKey: "agentTools.retry",
      variant: "default",
    };
  if (canUpdateAgentTool(tool))
    return {
      intent: "update",
      labelKey: "agentTools.actions.update",
      variant: "default",
    };
  if (tool.installed === false && actionsOf(tool).includes("install"))
    return {
      intent: "install",
      labelKey: "agentTools.actions.install",
      variant: "outline",
    };
  return null;
}

// An external installation stays untouched; installing creates Pages' own managed one.
function actionLabelKey(tool: AgentToolView, action: AgentToolAction): string {
  return action === "install" && tool.source === "system"
    ? "agentTools.actions.installManaged"
    : `agentTools.actions.${action}`;
}

function UpdateMenuItem({
  tool,
  isDisabled,
  onSelect,
}: {
  readonly tool: AgentToolView;
  readonly isDisabled: boolean;
  readonly onSelect: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const version = agentToolTargetVersion(tool);
  return (
    <DropdownMenuItem
      className="min-h-9 justify-between gap-3 font-semibold text-primary data-highlighted:bg-primary-subtle"
      disabled={isDisabled}
      onSelect={onSelect}
    >
      <span>{t("agentTools.actions.update")}</span>
      {version !== null && !isDisabled ? (
        <span className="text-xs font-normal text-muted-foreground">
          {t("agentTools.update.toVersion", { version })}
        </span>
      ) : null}
    </DropdownMenuItem>
  );
}

function AgentToolMenu({
  tool,
  isPending,
  onSelect,
}: {
  readonly tool: AgentToolView;
  readonly isPending: boolean;
  readonly onSelect: (intent: AgentToolIntent) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const switchIntent = tool.enabled ? "disable" : "enable";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("agentTools.actionsFor", {
            tool: t(`agentTools.names.${tool.id}`),
          })}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={4}
        className="w-63"
        containerClassName="rounded-lg"
      >
        <UpdateMenuItem
          tool={tool}
          isDisabled={isActionDisabled(tool, "update", isPending)}
          onSelect={() => onSelect("update")}
        />
        {MENU_ACTIONS.map((action) => (
          <DropdownMenuItem
            key={action}
            className={MENU_ITEM_CLASS}
            disabled={isActionDisabled(tool, action, isPending)}
            onSelect={() => onSelect(action)}
          >
            {t(actionLabelKey(tool, action))}
          </DropdownMenuItem>
        ))}
        {isAgentToolSwitchable(tool) ? (
          <DropdownMenuItem
            className={MENU_ITEM_CLASS}
            disabled={isPending}
            onSelect={() => onSelect(switchIntent)}
          >
            {t(`agentTools.actions.${switchIntent}`)}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="min-h-9 text-destructive"
          disabled={isActionDisabled(tool, "remove", isPending)}
          onSelect={() => onSelect("remove")}
        >
          {t("agentTools.actions.remove")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ActionConfirmation({
  tool,
  intent,
  onClose,
  onConfirm,
}: {
  readonly tool: AgentToolView;
  readonly intent: AgentToolIntent;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size="sm" aria-describedby={undefined}>
        <DialogTitle className="text-base font-semibold">
          {t(`agentTools.confirm.${intent}`, {
            tool: t(`agentTools.names.${tool.id}`),
          })}
        </DialogTitle>
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">{t("settings.agents.cancel")}</Button>
          </DialogClose>
          <Button
            variant={intent === "remove" ? "destructive" : "default"}
            onClick={onConfirm}
          >
            {t(`agentTools.actions.${intent}`)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The right edge of a tool row: at most one main action and the menu "…" with every fixed operation.
 * @remarks
 * Rights, serialization and the protection of active processes are enforced
 * by the service. "Aktualisieren" starts at once and names the checked
 * target the row sends along; removing and rolling back ask first.
 */
export function AgentToolActions({
  tool,
  isPending,
  onSubmit,
}: {
  readonly tool: AgentToolView;
  readonly isPending: boolean;
  readonly onSubmit: (intent: AgentToolIntent) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState<AgentToolIntent | null>(null);
  const primary = primaryActionOf(tool);

  function handleSelect(intent: AgentToolIntent): void {
    if (CONFIRMED_ACTIONS.includes(intent)) {
      setConfirming(intent);
      return;
    }
    onSubmit(intent);
  }

  function handleConfirm(): void {
    if (confirming) onSubmit(confirming);
    setConfirming(null);
  }

  return (
    <div className="relative flex items-center justify-end gap-2">
      {primary ? (
        <Button
          size="xs"
          variant={primary.variant}
          disabled={isPending}
          onClick={() => handleSelect(primary.intent)}
        >
          {t(primary.labelKey)}
        </Button>
      ) : null}
      <AgentToolMenu
        tool={tool}
        isPending={isPending}
        onSelect={handleSelect}
      />
      {confirming ? (
        <ActionConfirmation
          tool={tool}
          intent={confirming}
          onClose={() => setConfirming(null)}
          onConfirm={handleConfirm}
        />
      ) : null}
    </div>
  );
}
