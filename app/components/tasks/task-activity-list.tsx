import { useTranslation } from "react-i18next";

import type { WorkItemHistory } from "@/definition/Task";

interface TaskActivityListProps {
  readonly history: readonly WorkItemHistory[];
}

/** Renders the chronological audit trail shared by ticket detail surfaces. */
export function TaskActivityList({
  history,
}: TaskActivityListProps): React.ReactElement {
  const { t } = useTranslation();

  if (history.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        {t("tasks.none")}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {history.map((record) => (
        <li key={record.id} className="rounded-xl bg-muted/40 p-3 text-xs">
          <p className="font-medium text-foreground">
            {t(`tasks.history.${record.action}`, {
              field: record.field ?? "",
              newValue: record.newValue ?? "",
              oldValue: record.oldValue ?? "",
              user: record.userDisplayName ?? "Benutzer",
            })}
          </p>
          <span className="mt-1 block text-[11px] text-muted-foreground">
            {record.createdAt}
          </span>
        </li>
      ))}
    </ul>
  );
}
