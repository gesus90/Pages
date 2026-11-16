import { Bot, Plug, Server, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { cn } from "@/app/lib/cn";

import { useMarkedSettingsArea } from "./use-settings-area";

import type { ReactNode } from "react";

interface SettingsNavigationProps {
  /** Whether the system area is listed. */
  readonly canViewSystem: boolean;
}

interface SettingsNavigationLinkProps {
  readonly to: string;
  readonly icon: ReactNode;
  readonly isCurrent: boolean;
  readonly children: ReactNode;
}

function SettingsNavigationLink({
  to,
  icon,
  isCurrent,
  children,
}: SettingsNavigationLinkProps): React.ReactElement {
  return (
    <Link
      aria-current={isCurrent ? "page" : undefined}
      className={cn(
        "inline-flex h-7 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary",
        isCurrent && "bg-surface text-foreground shadow-xs hover:bg-surface",
      )}
      prefetch="intent"
      to={to}
    >
      {icon}
      {children}
    </Link>
  );
}

/**
 * Links the settings areas the visitor may open.
 * @remarks
 * The area the person moves to is marked at once, while its data still
 * loads; the area shown so far loses the mark at the same moment.
 */
export function SettingsNavigation({
  canViewSystem,
}: SettingsNavigationProps): React.ReactElement {
  const { t } = useTranslation();
  const area = useMarkedSettingsArea();

  return (
    <nav
      aria-label={t("settings.navigation.label")}
      className="mt-4 inline-flex h-9 w-fit max-w-full shrink-0 items-center gap-0.5 overflow-x-auto rounded-xl bg-muted/70 p-1"
    >
      <SettingsNavigationLink
        icon={<UserRound className="size-4 text-primary" aria-hidden="true" />}
        isCurrent={area === "/settings/profile"}
        to="/settings/profile"
      >
        {t("settings.navigation.personal")}
      </SettingsNavigationLink>
      <SettingsNavigationLink
        icon={<Plug className="size-4 text-primary" aria-hidden="true" />}
        isCurrent={area === "/settings/connections"}
        to="/settings/connections"
      >
        {t("settings.navigation.connections")}
      </SettingsNavigationLink>
      {canViewSystem ? (
        <SettingsNavigationLink
          icon={<Server className="size-4 text-primary" aria-hidden="true" />}
          isCurrent={area === "/settings/system"}
          to="/settings/system"
        >
          {t("settings.navigation.system")}
        </SettingsNavigationLink>
      ) : null}
      {canViewSystem ? (
        <SettingsNavigationLink
          icon={<Bot className="size-4 text-primary" aria-hidden="true" />}
          isCurrent={area === "/settings/agents"}
          to="/settings/agents"
        >
          {t("settings.navigation.agents")}
        </SettingsNavigationLink>
      ) : null}
    </nav>
  );
}
