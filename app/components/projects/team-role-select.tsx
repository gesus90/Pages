import { Crown, Eye, Users } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import { TEAM_ROLE_ORDER } from "@/app/lib/team-members";
import { PROJECT_ROLE } from "@/definition/Project";

import type { ProjectRole } from "@/definition/Project";

interface RoleIconProps {
  readonly role: ProjectRole;
}

/** Renders the role icon shared by the table, dropdowns, and legend. */
export function RoleIcon({ role }: RoleIconProps): React.ReactElement {
  if (role === PROJECT_ROLE.MANAGER) {
    return <Crown className="size-4 text-primary" aria-hidden="true" />;
  }

  if (role === PROJECT_ROLE.MEMBER) {
    return (
      <Users className="size-4 text-muted-foreground" aria-hidden="true" />
    );
  }

  return <Eye className="size-4 text-muted-foreground" aria-hidden="true" />;
}

interface TeamRoleSelectProps {
  readonly id: string;
  readonly value: ProjectRole;
  readonly onChange: (role: ProjectRole) => void;
  readonly className: string;
}

/** Renders a select offering every project role with its description. */
export function TeamRoleSelect({
  id,
  value,
  onChange,
  className,
}: TeamRoleSelectProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Select
      ariaLabel={t("projectDetail.team.role")}
      className={className}
      id={id}
      onValueChange={onChange}
      options={TEAM_ROLE_ORDER.map((option) => ({
        description: t(`projectDetail.team.roleDescriptions.${option}`),
        icon: <RoleIcon role={option} />,
        label: t(`projectDetail.team.${option}`),
        value: option,
      }))}
      value={value}
    />
  );
}
