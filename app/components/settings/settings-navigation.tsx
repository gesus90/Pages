import { Server, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";

import { cn } from "@/app/lib/cn";

import type { ReactNode } from "react";

interface SettingsNavigationProps {
  /** Whether the system area is listed. */
  readonly canViewSystem: boolean;
}

interface SettingsNavigationLinkProps {
  readonly to: string;
  readonly icon: ReactNode;
  readonly children: ReactNode;
}

function SettingsNavigationLink({
  to,
  icon,
  children,
}: SettingsNavigationLinkProps): React.ReactElement {
  return (
    <NavLink
      className={({ isActive }) =>
        cn(
          "inline-flex min-h-10 items-center gap-2 rounded-xl px-3.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-sidebar-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary",
          isActive && "bg-primary-subtle text-foreground shadow-xs",
        )
      }
      prefetch="intent"
      to={to}
    >
      {icon}
      {children}
    </NavLink>
  );
}

/** Links the settings areas the visitor may open. */
export function SettingsNavigation({
  canViewSystem,
}: SettingsNavigationProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t("settings.navigation.label")}
      className="mt-4 flex shrink-0 flex-wrap gap-1"
    >
      <SettingsNavigationLink
        icon={<UserRound className="size-4 text-primary" aria-hidden="true" />}
        to="/settings/profile"
      >
        {t("settings.navigation.personal")}
      </SettingsNavigationLink>
      {canViewSystem ? (
        <SettingsNavigationLink
          icon={<Server className="size-4 text-primary" aria-hidden="true" />}
          to="/settings/system"
        >
          {t("settings.navigation.system")}
        </SettingsNavigationLink>
      ) : null}
    </nav>
  );
}
