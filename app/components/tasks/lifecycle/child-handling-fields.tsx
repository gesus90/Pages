import { useTranslation } from "react-i18next";

import { WORK_ITEM_TYPE } from "@/definition/Task";

import type { TFunction } from "i18next";
import type {
  WorkItemDetail,
  WorkItemType,
  WorkItemTypeCounts,
} from "@/definition/Task";

const TYPE_ORDER: readonly WorkItemType[] = [
  WORK_ITEM_TYPE.INITIATIVE,
  WORK_ITEM_TYPE.EPIC,
  WORK_ITEM_TYPE.TASK,
  WORK_ITEM_TYPE.SUBTASK,
];

/**
 * Counts the descendants of all types together.
 *
 * @param counts - Descendants per type.
 * @returns How many there are.
 */
export function countAll(counts: WorkItemTypeCounts): number {
  return TYPE_ORDER.reduce((total, type) => total + counts[type], 0);
}

/**
 * Lists the descendants per type in words, such as "2 Epics, 5 Tasks".
 *
 * @param counts - Descendants per type.
 * @param t - Translation function.
 * @returns The list, empty without descendants.
 */
export function describeCounts(
  counts: WorkItemTypeCounts,
  t: TFunction,
): string {
  return TYPE_ORDER.filter((type) => counts[type] > 0)
    .map((type) => t(`tasks.count.${type}`, { count: counts[type] }))
    .join(", ");
}

interface ChildHandlingFieldsProps {
  readonly ticket: Pick<WorkItemDetail, "type">;
  /** The descendants the action reaches, or `null` when they are unknown. */
  readonly counts: WorkItemTypeCounts | null;
  /** Tells that subtasks go along, worded for archiving or deleting. */
  readonly subtasksNote: string;
}

/**
 * Names the descendants an archive or deletion reaches and lets the person
 * choose for initiatives and epics whether the children go along or stay
 * without a parent (A8.2-E04). The choice travels as the form field
 * `children`.
 */
export function ChildHandlingFields({
  ticket,
  counts,
  subtasksNote,
}: ChildHandlingFieldsProps): React.ReactElement {
  const { t } = useTranslation();
  const total = counts === null ? 0 : countAll(counts);

  if (counts === null || total === 0) {
    return (
      <>
        <input name="children" type="hidden" value="include" />
        <p className="text-sm text-muted-foreground">
          {t("tasks.lifecycle.noChildren")}
        </p>
      </>
    );
  }

  const canKeep =
    ticket.type === WORK_ITEM_TYPE.INITIATIVE ||
    ticket.type === WORK_ITEM_TYPE.EPIC;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-foreground">
        {t("tasks.lifecycle.affected", { list: describeCounts(counts, t) })}
      </p>
      {canKeep ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-semibold text-foreground">
            {t("tasks.lifecycle.handling")}
          </legend>
          <label className="flex items-start gap-2">
            <input
              defaultChecked
              className="mt-1"
              name="children"
              type="radio"
              value="include"
            />
            {t("tasks.lifecycle.include")}
          </label>
          <label className="flex items-start gap-2">
            <input className="mt-1" name="children" type="radio" value="keep" />
            {t("tasks.lifecycle.keep")}
          </label>
        </fieldset>
      ) : (
        <>
          <input name="children" type="hidden" value="include" />
          <p className="text-muted-foreground">{subtasksNote}</p>
        </>
      )}
    </div>
  );
}
