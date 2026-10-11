import { Bot, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation } from "react-router";

import { cn } from "@/app/lib/cn";

/** Links the work navigation to the existing central panel, without a second list route. */
export function AgentNavigation(props: {
  readonly canManage?: boolean;
  readonly onNavigate?: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const panelId = useId();
  const location = useLocation();
  const isActive =
    location.pathname === "/settings/agents" ||
    location.pathname.startsWith("/agents/");
  const [isOpen, setOpen] = useState(isActive);
  return (
    <div>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setOpen(!isOpen)}
        className="flex min-h-12 w-full items-center gap-4 rounded-xl px-5 text-lg font-medium text-muted-foreground transition-colors hover:bg-sidebar-hover hover:text-foreground xl:min-h-10 xl:gap-3 xl:px-3 xl:text-sm"
      >
        <Bot className="size-6 text-primary xl:size-5" aria-hidden="true" />
        {t("navigation.agents")}
        <ChevronDown
          className={cn(
            "ml-auto size-4 transition-transform",
            isOpen && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      {isOpen ? (
        <div id={panelId} className="ml-5 border-l border-border pl-2">
          <NavLink
            to="/agents/plans"
            onClick={props.onNavigate}
            className={({ isActive: isPlanActive }) =>
              cn(
                "flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-sidebar-hover hover:text-foreground",
                isPlanActive && "bg-primary-subtle text-foreground shadow-xs",
              )
            }
          >
            {t("navigation.executionPlan")}
          </NavLink>
          <NavLink
            to="/agents/workspaces"
            onClick={props.onNavigate}
            className={({ isActive: isWorkspaceActive }) =>
              cn(
                "flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-sidebar-hover hover:text-foreground xl:min-h-9",
                isWorkspaceActive &&
                  "bg-primary-subtle text-foreground shadow-xs",
              )
            }
          >
            {t("navigation.workspace")}
          </NavLink>
          <NavLink
            to="/settings/agents"
            onClick={props.onNavigate}
            className={cn(
              "flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-sidebar-hover hover:text-foreground xl:min-h-9",
              location.pathname === "/settings/agents" &&
                "bg-primary-subtle text-foreground shadow-xs",
            )}
          >
            {t("navigation.agentList")}
          </NavLink>
        </div>
      ) : null}
    </div>
  );
}
