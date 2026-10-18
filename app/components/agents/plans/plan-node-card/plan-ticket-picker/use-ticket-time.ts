import { useTranslation } from "react-i18next";

import { useRegionFormat } from "@/app/components/common/region-provider";
import {
  calendarDaysBefore,
  formatDate,
  formatDateTime,
  formatTimeOfDay,
  parseInstant,
} from "@/app/lib/region-format";

import type { AgentPlanTask } from "@/definition/AgentPlan";
import type { TicketSort } from "./ticket-picker-results";

/** The time line of a ticket row and the exact times behind it. */
export interface TicketTime {
  /** Such as `Geändert heute, 18:40`, in the visitor's time zone. */
  readonly text: string;
  /** The shown instant as ISO text for `<time>`, or `undefined` when unknown. */
  readonly dateTime: string | undefined;
  /** Creation and change time in full. */
  readonly exact: string;
}

/**
 * Describes when a ticket was created or changed, matching the order.
 *
 * @returns A function from ticket and order to its time line; ordering by
 * creation shows the creation time, every other order the change time.
 *
 * @remarks
 * Today and yesterday are real calendar days of the visitor's time zone;
 * older times show their date. A missing time says so instead of
 * borrowing the current time.
 */
export function useTicketTime(): (
  task: AgentPlanTask,
  sort: TicketSort,
) => TicketTime {
  const { t } = useTranslation();
  const region = useRegionFormat();
  const now = new Date();
  return (task, sort) => {
    const kind = sort === "created" ? "created" : "updated";
    const value = kind === "created" ? task.createdAt : task.updatedAt;
    const instant = value ? parseInstant(value) : null;
    const exact = t("plans.ticketPicker.time.exact", {
      created: formatDateTime(task.createdAt || null, region),
      updated: formatDateTime(task.updatedAt || null, region),
    });
    if (!value || instant === null)
      return {
        text: t(`plans.ticketPicker.time.${kind}.missing`),
        dateTime: undefined,
        exact,
      };
    const days = calendarDaysBefore(value, now, region);
    let day = "other";
    if (days === 0) day = "today";
    if (days === 1) day = "yesterday";
    return {
      text: t(`plans.ticketPicker.time.${kind}.${day}`, {
        date: formatDate(value, region),
        time: formatTimeOfDay(value, region),
      }),
      dateTime: instant.toISOString(),
      exact,
    };
  };
}
