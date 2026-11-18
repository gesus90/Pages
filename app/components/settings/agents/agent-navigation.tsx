import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation } from "react-router";

import { cn } from "@/app/lib/cn";

/**
 * Whether the navigation marks "Agents" as the current area.
 * @param pathname - The path of the open page.
 * @returns `true` on the Agents page, every page below it and the agent settings.
 */
export function isAgentAreaPath(pathname: string): boolean {
  return (
    pathname === "/agents" ||
    pathname.startsWith("/agents/") ||
    pathname === "/settings/agents"
  );
}

/**
 * The entry "Agents" of the main navigation: a plain link to the Agents page.
 * @remarks
 * It neither opens nor lists sub-entries; Agent Plan, runs and the working
 * directory are reached through the link buttons of the Agents page. A tap
 * in the mobile menu closes the menu and opens the page.
 */
export function AgentNavigation(props: {
  readonly canManage?: boolean;
  readonly onNavigate?: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const location = useLocation();
  const isActive = isAgentAreaPath(location.pathname);
  return (
    <NavLink
      to="/agents"
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
  );
}
