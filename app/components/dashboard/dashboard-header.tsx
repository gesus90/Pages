import { useTranslation } from "react-i18next";

interface DashboardHeaderProps {
  readonly displayName: string;
  /** Local hour of the day, from 0 to 23, that selects the greeting. */
  readonly hour: number;
}

function getGreetingKey(hour: number): string {
  if (hour < 12) {
    return "dashboard.greeting.morning";
  }

  if (hour < 18) {
    return "dashboard.greeting.day";
  }

  return "dashboard.greeting.evening";
}

/** Renders the personalized greeting and the dashboard subtitle. */
export function DashboardHeader({
  displayName,
  hour,
}: DashboardHeaderProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <header className="shrink-0 px-1 pt-1 pb-5">
      <h1 className="select-none text-3xl font-bold tracking-tight text-foreground xl:text-4xl">
        {t(getGreetingKey(hour), { name: displayName })}
      </h1>
      <p className="mt-1 text-base text-muted-foreground select-none">
        {t("dashboard.subtitle")}
      </p>
    </header>
  );
}
