import { useTranslation } from "react-i18next";
import { Checkbox } from "@/app/components/ui/checkbox";
import type { Department } from "@/definition/Authorization";

interface DepartmentChoicesProps {
  readonly departments: readonly Department[];
  readonly selected: readonly string[];
  readonly allowed: readonly string[];
}

/** Foreign memberships remain readable and are retained as hidden form fields. */
export function DepartmentChoices({
  departments,
  selected,
  allowed,
}: DepartmentChoicesProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-sm font-medium">
        {t("users.sections.departments")}
      </legend>
      {departments.map((department) => {
        const checked = selected.includes(department.id);
        const disabled = !allowed.includes(department.id);
        return (
          <label
            key={department.id}
            className="flex items-center gap-2 text-sm"
          >
            <Checkbox
              name="department"
              value={department.id}
              defaultChecked={checked}
              disabled={disabled}
            />
            {disabled && checked ? (
              <input type="hidden" name="department" value={department.id} />
            ) : null}
            <span className="pages-selectable">{department.name}</span>
          </label>
        );
      })}
      {departments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("users.noDepartments")}
        </p>
      ) : null}
    </fieldset>
  );
}
