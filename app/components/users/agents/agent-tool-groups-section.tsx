import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import {
  AGENT_TOOL_GROUPS,
  agentToolPolicy,
} from "@/definition/AgentToolGroups";

import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type {
  AgentToolGroup,
  AgentToolGroupMode,
} from "@/definition/AgentToolGroups";

interface AgentToolGroupsSectionProps {
  readonly access: AgentEmployeeAccess;
  readonly disabled: readonly AgentToolGroup[];
  /** The groups switched off when the agent was loaded; `null` for a new agent. */
  readonly savedDisabled: readonly AgentToolGroup[] | null;
  readonly onChange: (disabled: readonly AgentToolGroup[]) => void;
  /** Whether the person may edit the agent at all. */
  readonly canEdit: boolean;
  /** Whether the person may switch a saved disabled group on again: an administrator in active admin mode. */
  readonly canEnable: boolean;
}

/** One group with its description, its mode in the level and its switch. */
function ToolGroupRow({
  group,
  mode,
  isOn,
  isLocked,
  onToggle,
}: {
  readonly group: AgentToolGroup;
  readonly mode: AgentToolGroupMode;
  readonly isOn: boolean;
  readonly isLocked: boolean;
  readonly onToggle: (group: AgentToolGroup, isOn: boolean) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const isAvailable = mode !== "off";
  return (
    <li>
      <label
        className={cn(
          "flex items-start gap-3 px-3 py-2 text-sm",
          isLocked || !isAvailable
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer",
        )}
      >
        <input
          checked={isAvailable && isOn}
          className="mt-1"
          disabled={isLocked || !isAvailable}
          name={`agent-tool-group-${group}`}
          onChange={(event) => onToggle(group, event.target.checked)}
          type="checkbox"
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold text-foreground">
            {t(`agentEmployees.accessTab.toolGroups.group.${group}`)}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {t(`agentEmployees.accessTab.toolGroups.mode.${mode}`)}
            </span>
          </span>
          <span className="text-muted-foreground">
            {t(`agentEmployees.accessTab.toolGroups.description.${group}`)}
          </span>
        </span>
      </label>
    </li>
  );
}

/**
 * The tool groups of the agent's chats (PAGE-390): every group with what the
 * access level allows, and a switch to turn single groups off.
 *
 * @remarks
 * Switching a group off narrows the agent and is open to everyone who edits
 * it; switching a saved disabled group on again widens it, so only an
 * administrator in active admin mode may. The server checks both again.
 */
export function AgentToolGroupsSection({
  access,
  disabled,
  savedDisabled,
  onChange,
  canEdit,
  canEnable,
}: AgentToolGroupsSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const levelModes = agentToolPolicy(access);

  function toggle(group: AgentToolGroup, isOn: boolean): void {
    onChange(
      isOn
        ? disabled.filter((entry) => entry !== group)
        : AGENT_TOOL_GROUPS.filter(
            (entry) => entry === group || disabled.includes(entry),
          ),
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">
        {t("agentEmployees.accessTab.toolGroups.title")}
      </h3>
      <p className="text-xs text-muted-foreground">
        {t("agentEmployees.accessTab.toolGroups.hint")}
      </p>
      {canEnable ? null : (
        <p className="text-xs text-muted-foreground">
          {t("agentEmployees.accessTab.toolGroups.adminOnly")}
        </p>
      )}
      <ul className="flex flex-col divide-y divide-border/60 rounded-xl border border-border">
        {AGENT_TOOL_GROUPS.map((group) => {
          const isOn = !disabled.includes(group);
          const wasOff = savedDisabled?.includes(group) === true;
          return (
            <ToolGroupRow
              group={group}
              isLocked={!canEdit || (!isOn && wasOff && !canEnable)}
              isOn={isOn}
              key={group}
              mode={levelModes[group]}
              onToggle={toggle}
            />
          );
        })}
      </ul>
    </section>
  );
}
