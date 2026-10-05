import { CalendarPlus, Plus, Users, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

/** Renders shortcuts to creating a task, planning a date and managing the team. */
export function GeneralQuickActionsSection(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <section className="rounded-2xl bg-muted/40 p-6">
      <h2 className="flex select-none items-center gap-2 font-semibold text-foreground">
        <Zap className="size-5 text-primary" aria-hidden="true" />
        {t("projectDetail.general.quickActions")}
      </h2>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Link
          to="/aufgaben"
          prefetch="intent"
          className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl bg-primary px-2 py-3 text-center text-xs font-semibold text-primary-foreground transition-all hover:brightness-[1.04]"
        >
          <Plus className="size-5 shrink-0" aria-hidden="true" />
          {t("projectDetail.general.newTask")}
        </Link>
        <Link
          to="?tab=planning"
          prefetch="intent"
          className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl bg-surface px-2 py-3 text-center text-xs font-semibold text-foreground shadow-xs transition-colors hover:bg-surface-hover"
        >
          <CalendarPlus className="size-5 shrink-0" aria-hidden="true" />
          {t("projectDetail.general.planEvent")}
        </Link>
        <Link
          to="?tab=team"
          prefetch="intent"
          className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl bg-surface px-2 py-3 text-center text-xs font-semibold text-foreground shadow-xs transition-colors hover:bg-surface-hover"
        >
          <Users className="size-5 shrink-0" aria-hidden="true" />
          {t("projectDetail.general.manageTeam")}
        </Link>
      </div>
    </section>
  );
}
