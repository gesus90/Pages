import { useTranslation } from "react-i18next";

import { SearchableSelect } from "@/app/components/ui/searchable-select";

import { REMOTE_SELECT_TRIGGER_CLASS } from "./remote-field-style";

import type { Department } from "@/definition/Authorization";

/**
 * The only sharing control of a connection: one department, chosen from a
 * searchable list.
 *
 * @remarks
 * Opening, searching and closing the list change nothing; only choosing a
 * department changes the draft, and only saving the dialog stores it.
 */
export function RemoteDepartmentSelect(props: {
  readonly id: string;
  readonly value: string;
  readonly departments: readonly Department[];
  readonly disabled: boolean;
  readonly onValueChange: (departmentId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const options = [...props.departments]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((department) => ({ value: department.id, label: department.name }));
  return (
    <SearchableSelect
      id={props.id}
      label={t("remote.dialog.department")}
      value={props.value}
      options={options}
      disabled={props.disabled}
      className={REMOTE_SELECT_TRIGGER_CLASS}
      onValueChange={props.onValueChange}
      texts={{
        placeholder: t("remote.dialog.departmentPlaceholder"),
        unavailable: t("remote.dialog.departmentUnavailable"),
        search: t("remote.dialog.departmentSearch"),
        empty: t("remote.dialog.departmentEmpty"),
        count: (count, total) =>
          t("remote.dialog.departmentCount", { count, total }),
      }}
    />
  );
}
