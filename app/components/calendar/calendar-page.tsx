import { useState } from "react";
import { useTranslation } from "react-i18next";

import { calendarFilterOf } from "@/definition/Calendar";

import { calendarColorOf } from "./calendar-colors";
import { CalendarContextProvider } from "./calendar-context";
import { weekDates } from "./calendar-dates";
import { CalendarEntryDialog } from "./calendar-entry-dialog";
import { CalendarEventFormDialog } from "./calendar-event-form-dialog";
import { useCalendarFormatter } from "./calendar-format";
import { CalendarHeader } from "./calendar-header";
import { CalendarListView } from "./calendar-list-view";
import { CalendarMonthView } from "./calendar-month-view";
import { CalendarSidebar } from "./calendar-sidebar";
import { CalendarTimeGrid } from "./calendar-time-grid";
import { useCalendarNavigation } from "./use-calendar-navigation";
import { useCalendarNow } from "./use-calendar-now";
import { useCalendarPreferences } from "./use-calendar-preferences";

import type { TFunction } from "i18next";
import type {
  CalendarFilterKey,
  CalendarScope,
  CalendarViewEntry,
} from "@/definition/Calendar";
import type {
  CalendarDraftStart,
  CalendarViewContext,
} from "./calendar-context";
import type { EventFormRequest } from "./calendar-event-form-dialog";
import type {
  CalendarPageData,
  CalendarPageProject,
} from "./calendar-page-data";
import type { CalendarFilterItem } from "./calendar-sidebar";
import type { CalendarNow } from "./use-calendar-now";

interface CalendarPageProps {
  readonly page: CalendarPageData;
}

interface CalendarBodyProps {
  readonly page: CalendarPageData;
  readonly entries: readonly CalendarViewEntry[];
  readonly now: CalendarNow | null;
}

/** The own projects and every further project an entry belongs to. */
function projectsOf(page: CalendarPageData): CalendarPageProject[] {
  const projects = [...page.projects];
  for (const entry of page.entries) {
    const { projectId, name } = entry.calendar;
    if (entry.calendar.kind !== "project" || projectId === null) continue;
    if (!projects.some((project) => project.id === projectId))
      projects.push({ id: projectId, name });
  }
  return projects;
}

function filterItems(
  projects: readonly CalendarPageProject[],
  t: TFunction,
): CalendarFilterItem[] {
  const projectIds = projects.map((project) => project.id);
  const item = (key: CalendarFilterKey, label: string): CalendarFilterItem => ({
    key,
    label,
    color: calendarColorOf(key, projectIds),
  });
  return [
    item("mine", t("calendar.filters.mine")),
    item("invitations", t("calendar.filters.invitations")),
    ...projects.map((project) =>
      item(
        `project:${project.id}`,
        t("calendar.filters.project", { name: project.name }),
      ),
    ),
    item("deadlines", t("calendar.filters.deadlines")),
  ];
}

/** The shown view: the hour grid of a day or a week, the month or the list. */
function CalendarBody({
  page,
  entries,
  now,
}: CalendarBodyProps): React.ReactElement {
  switch (page.view) {
    case "day":
      return (
        <CalendarTimeGrid dates={[page.date]} entries={entries} now={now} />
      );
    case "week":
      return (
        <CalendarTimeGrid
          dates={weekDates(page.date)}
          entries={entries}
          now={now}
        />
      );
    case "month":
      return <CalendarMonthView date={page.date} entries={entries} />;
    case "list":
      return (
        <CalendarListView from={page.from} to={page.to} entries={entries} />
      );
  }
}

/**
 * The calendar page (PAGE-301): the left column with the small month and
 * the calendars, the head with the views, the shown view, the detail of an
 * entry and the event form.
 */
export function CalendarPage({ page }: CalendarPageProps): React.ReactElement {
  const { t } = useTranslation();
  const format = useCalendarFormatter(page.timeZone);
  const navigation = useCalendarNavigation(page.view, page.date, page.today);
  const visibility = useCalendarPreferences(page.userId, page.view);
  const now = useCalendarNow(page.timeZone);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [selected, setSelected] = useState<CalendarViewEntry | null>(null);
  const [formRequest, setFormRequest] = useState<EventFormRequest | null>(null);
  const projects = projectsOf(page);
  const filters = filterItems(projects, t);
  const colors = new Map(filters.map((filter) => [filter.key, filter.color]));
  const entries = page.entries.filter(
    (entry) => !visibility.hidden.has(calendarFilterOf(entry)),
  );
  // The detail follows a reload of the range, such as after an answer.
  const shownEntry =
    selected === null
      ? null
      : (page.entries.find((entry) => entry.id === selected.id) ?? selected);

  const context: CalendarViewContext = {
    today: page.today,
    format,
    colorOf: (entry) =>
      colors.get(calendarFilterOf(entry)) ?? calendarColorOf("mine", []),
    openEntry: setSelected,
    createAt: (start: CalendarDraftStart) =>
      setFormRequest({ mode: "create", start }),
    openDay: navigation.openDay,
  };

  function handleEdit(entry: CalendarViewEntry, scope: CalendarScope): void {
    setSelected(null);
    setFormRequest({ mode: "edit", entry, scope });
  }

  return (
    <CalendarContextProvider value={context}>
      <div className="flex flex-col gap-4 md:h-[calc(100dvh-8.5rem)] md:min-h-[36rem] md:flex-row md:gap-6">
        <CalendarSidebar
          date={page.date}
          filters={filters}
          hidden={visibility.hidden}
          isOpen={isSidebarOpen}
          onCreate={() =>
            setFormRequest({
              mode: "create",
              start: { date: page.date, minute: null },
            })
          }
          onSelectDate={navigation.setDate}
          onToggleFilter={visibility.toggle}
        />
        <section className="flex h-[calc(100dvh-8.5rem)] min-h-[28rem] min-w-0 flex-1 flex-col md:h-auto">
          <CalendarHeader
            view={page.view}
            date={page.date}
            navigation={navigation}
            onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          />
          <CalendarBody page={page} entries={entries} now={now} />
        </section>
      </div>
      <CalendarEntryDialog
        entry={shownEntry}
        onClose={() => setSelected(null)}
        onEdit={handleEdit}
      />
      <CalendarEventFormDialog
        request={formRequest}
        targets={page.targets}
        timeZone={page.timeZone}
        onClose={() => setFormRequest(null)}
      />
    </CalendarContextProvider>
  );
}
