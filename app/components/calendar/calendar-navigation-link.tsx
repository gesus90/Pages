import { CalendarDays } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";

interface CalendarNavigationLinkProps {
  /** Open invitations of the account; the badge hides at zero. */
  readonly invitations: number;
  readonly getClassName: (isActive: boolean) => string;
  readonly onNavigate?: () => void;
}

/** The calendar (PAGE-301) in the main navigation, with the open invitations. */
export function CalendarNavigationLink({
  invitations,
  getClassName,
  onNavigate,
}: CalendarNavigationLinkProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <NavLink
      className={({ isActive }) => getClassName(isActive)}
      to="/kalender"
      prefetch="intent"
      onClick={onNavigate}
    >
      <CalendarDays
        className="size-6 text-primary xl:size-5"
        aria-hidden="true"
      />
      <span className="flex-1">{t("navigation.calendar")}</span>
      {invitations > 0 ? (
        <span
          className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-semibold text-primary-foreground"
          aria-label={t("navigation.calendarInvitations", {
            count: invitations,
          })}
        >
          {invitations}
        </span>
      ) : null}
    </NavLink>
  );
}
