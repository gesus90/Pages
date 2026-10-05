import { useTranslation } from "react-i18next";

import { RoleIcon } from "@/app/components/projects/team-role-select";
import { TEAM_ROLE_ORDER } from "@/app/lib/team-members";

/** Renders what every project role may do. */
export function TeamRoleLegend(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:gap-8">
      {TEAM_ROLE_ORDER.map((role) => (
        <div key={role} className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
            <RoleIcon role={role} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-foreground">
              {t(`projectDetail.team.${role}`)}
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              {t(`projectDetail.team.roleDescriptions.${role}`)}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
