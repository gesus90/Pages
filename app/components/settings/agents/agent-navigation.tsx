import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { matchPath, NavLink, useLocation } from "react-router";

import { cn } from "@/app/lib/cn";

import type { NavLinkRenderProps } from "react-router";

interface AgentSubEntry {
  readonly to: string;
  readonly labelKey: string;
  readonly className: string;
  readonly showOutsideAgentArea: boolean;
}

const SUB_ENTRY_CLASS =
  "flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-sidebar-hover hover:text-foreground";

const SUB_ENTRY_ACTIVE_CLASS =
  "bg-sidebar-active text-foreground inset-shadow-navigation-selection shadow-xs";

const AGENT_SUB_ENTRIES: readonly AgentSubEntry[] = [
  {
    to: "/agents/plans",
    labelKey: "navigation.executionPlan",
    className: SUB_ENTRY_CLASS,
    showOutsideAgentArea: false,
  },
  {
    to: "/agents/runs",
    labelKey: "navigation.runs",
    className: `${SUB_ENTRY_CLASS} xl:min-h-9`,
    showOutsideAgentArea: true,
  },
  {
    to: "/agents/workspaces",
    labelKey: "navigation.workspace",
    className: `${SUB_ENTRY_CLASS} xl:min-h-9`,
    showOutsideAgentArea: false,
  },
];

/**
 * Whether the navigation marks the entry "Agents" itself as the current page.
 * @param pathname - The path of the open page.
 * @returns `true` on the Agents page and the agent settings; a page below
 * "Agents" marks its own sub-entry instead.
 */
export function isAgentAreaPath(pathname: string): boolean {
  return pathname === "/agents" || pathname === "/settings/agents";
}

/**
 * The entry "Agents" of the main navigation with its sub-entries.
 * @remarks
 * Agent Plan and the working directory appear only on Agents pages. Runs
 * stays visible in every area. Selecting a link in the mobile menu closes it.
 */
export function AgentNavigation(props: {
  readonly canManage?: boolean;
  readonly onNavigate?: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const isActive = isAgentAreaPath(pathname);
  const isInAgentArea = matchPath("/agents/*", pathname) !== null;
  const visibleEntries = AGENT_SUB_ENTRIES.filter(
    (entry) => isInAgentArea || entry.showOutsideAgentArea,
  );
  return (
    <div>
      <NavLink
        to="/agents"
        end
        prefetch="intent"
        onClick={props.onNavigate}
        className={cn(
          "flex min-h-12 items-center gap-4 rounded-xl px-5 text-lg font-medium text-muted-foreground transition-colors hover:bg-sidebar-hover hover:text-foreground xl:min-h-10 xl:gap-3 xl:px-3 xl:text-sm",
          isActive &&
            "bg-sidebar-active text-foreground inset-shadow-navigation-selection shadow-(--navigation-selection-shadow)",
        )}
      >
        <Bot className="size-6 text-primary xl:size-5" aria-hidden="true" />
        {t("navigation.agents")}
      </NavLink>
      <div className="ml-5 border-l border-border pl-2">
        {visibleEntries.map((entry) => (
          <NavLink
            key={entry.to}
            to={entry.to}
            onClick={props.onNavigate}
            className={({ isActive: isEntryActive }: NavLinkRenderProps) =>
              cn(entry.className, isEntryActive && SUB_ENTRY_ACTIVE_CLASS)
            }
          >
            {t(entry.labelKey)}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
