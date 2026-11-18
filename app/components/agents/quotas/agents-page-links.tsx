import { FolderOpen, History, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { LucideIcon } from "lucide-react";

interface AgentsPageLink {
  readonly to: string;
  readonly labelKey: string;
  readonly icon: LucideIcon;
}

/** The areas below "Agents", which the navigation no longer lists itself. */
const AGENTS_PAGE_LINKS: readonly AgentsPageLink[] = [
  { to: "/agents/plans", labelKey: "navigation.executionPlan", icon: Workflow },
  { to: "/agents/runs", labelKey: "navigation.runs", icon: History },
  {
    to: "/agents/workspaces",
    labelKey: "navigation.workspace",
    icon: FolderOpen,
  },
];

/**
 * The link buttons under the title of the Agents page: Agent Plan, runs and
 * the working directory. On a narrow screen they wrap into the next line.
 */
export function AgentsPageLinks(): React.ReactElement {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("agentsPage.links")}
      className="mt-4 flex flex-wrap gap-2"
    >
      {AGENTS_PAGE_LINKS.map(({ to, labelKey, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          prefetch="intent"
          className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-border bg-surface px-3 text-xs font-semibold text-foreground transition-colors hover:bg-surface-hover"
        >
          <Icon className="size-3.5 text-primary" aria-hidden="true" />
          {t(labelKey)}
        </Link>
      ))}
    </nav>
  );
}
