import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { AgentPlanView } from "@/definition/AgentPlan";

const BADGE_CLASS =
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold";

/**
 * The access labels of the opened plan next to its name.
 * @remarks
 * "Admin-Zugriff" tells an administrator that the plan is somebody else's and
 * every action on it is recorded in its history.
 */
export function PlanAccessBadges({
  plan,
}: {
  readonly plan: AgentPlanView;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const isAdminAccess = plan.rights?.isAdminAccess === true;
  if (!isAdminAccess) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <span
        className={`${BADGE_CLASS} bg-primary-subtle text-primary`}
        data-plan-admin-access
      >
        <ShieldCheck aria-hidden="true" className="size-3" />
        {t("plans.access.adminBadge")}
      </span>
    </div>
  );
}
