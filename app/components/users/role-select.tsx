import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";

import type { Role } from "@/definition/Role";

interface RoleSelectProps {
  readonly id: string;
  readonly label: string;
  readonly roles: readonly Role[];
  readonly value: Role;
  readonly onChange: (role: Role) => void;
  readonly className: string;
}

/** Renders a select with the given roles, labelled with the role field name. */
export function RoleSelect({
  id,
  label,
  roles,
  value,
  onChange,
  className,
}: RoleSelectProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Select
      ariaLabel={label}
      className={className}
      id={id}
      onValueChange={onChange}
      options={roles.map((role) => ({
        label: t(`role.${role}`),
        value: role,
      }))}
      value={value}
    />
  );
}
