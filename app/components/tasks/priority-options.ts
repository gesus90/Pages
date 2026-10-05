import { useTranslation } from "react-i18next";

import { WORK_ITEM_PRIORITY } from "@/definition/Task";

import type { WorkItemPriority } from "@/definition/Task";

/** One entry of a priority select. */
export interface PriorityOption {
  readonly value: WorkItemPriority;
  readonly label: string;
}

/** Returns the priority choices in ascending order, with translated labels. */
export function usePriorityOptions(): readonly PriorityOption[] {
  const { t } = useTranslation();

  return [
    { label: t("tasks.priority.low"), value: WORK_ITEM_PRIORITY.LOW },
    { label: t("tasks.priority.normal"), value: WORK_ITEM_PRIORITY.NORMAL },
    { label: t("tasks.priority.high"), value: WORK_ITEM_PRIORITY.HIGH },
    { label: t("tasks.priority.urgent"), value: WORK_ITEM_PRIORITY.URGENT },
  ];
}
