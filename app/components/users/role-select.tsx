import { Select } from "@/app/components/ui/select";

import type { UserRole } from "@/definition/Authorization";

interface RoleSelectProps {
  readonly unassignedLabel?: string;
  readonly id: string;
  readonly label: string;
  readonly roles: readonly UserRole[];
  readonly value: string;
  readonly onChange: (role: string) => void;
  readonly className: string;
}

/** Renders a select with the given roles, labelled with the role field name. */
export function RoleSelect({
  unassignedLabel,
  id,
  label,
  roles,
  value,
  onChange,
  className,
}: RoleSelectProps): React.ReactElement {
  const options = roles.map((role) => ({ label: role.name, value: role.id }));
  if (unassignedLabel) options.unshift({ label: unassignedLabel, value: "" });
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <Select
        ariaLabel={label}
        className={className}
        id={id}
        onValueChange={onChange}
        options={options}
        value={value}
        size="default"
      />
    </div>
  );
}
