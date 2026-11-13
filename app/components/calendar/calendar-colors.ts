import type { CalendarFilterKey } from "@/definition/Calendar";

/** The theme classes of one calendar: its dot and the muted fill of its entries. */
export interface CalendarColor {
  readonly dot: string;
  readonly fill: string;
}

const MINE: CalendarColor = {
  dot: "bg-calendar-mine",
  fill: "bg-calendar-mine-fill",
};
const INVITATIONS: CalendarColor = {
  dot: "bg-calendar-invitations",
  fill: "bg-calendar-invitations-fill",
};
const DEADLINES: CalendarColor = {
  dot: "bg-calendar-deadlines",
  fill: "bg-calendar-deadlines-fill",
};

/** Projects take these colors in turn, in the order of the filter list. */
const PROJECT_COLORS: readonly CalendarColor[] = [
  { dot: "bg-calendar-project-1", fill: "bg-calendar-project-1-fill" },
  { dot: "bg-calendar-project-2", fill: "bg-calendar-project-2-fill" },
  { dot: "bg-calendar-project-3", fill: "bg-calendar-project-3-fill" },
  { dot: "bg-calendar-project-4", fill: "bg-calendar-project-4-fill" },
  { dot: "bg-calendar-project-5", fill: "bg-calendar-project-5-fill" },
];

/**
 * The color of a calendar of the filter list.
 *
 * @param key - The filter of an entry or of the list.
 * @param projectIds - The project IDs in the order of the filter list.
 */
export function calendarColorOf(
  key: CalendarFilterKey,
  projectIds: readonly string[],
): CalendarColor {
  if (key === "mine") return MINE;
  if (key === "invitations") return INVITATIONS;
  if (key === "deadlines") return DEADLINES;
  const index = projectIds.indexOf(key.slice("project:".length));
  return PROJECT_COLORS[Math.max(index, 0) % PROJECT_COLORS.length] ?? MINE;
}
