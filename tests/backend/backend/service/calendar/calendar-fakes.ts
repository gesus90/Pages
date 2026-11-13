import { CalendarService } from "@/backend/service/calendar/CalendarService";

import type {
  CalendarEventRecord,
  CalendarExceptionRecord,
  CalendarViewerScope,
  NewCalendarEvent,
} from "@/backend/database/repositories/calendar/CalendarEventRepository";
import type {
  CalendarInvitationRecord,
  CalendarOperationRecord,
  CalendarResponseRecord,
} from "@/backend/database/repositories/calendar/CalendarParticipationRepository";
import type { CalendarAccountRecord } from "@/backend/database/repositories/calendar/CalendarDirectoryRepository";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type {
  CalendarDependencies,
  CalendarInvitationNotice,
} from "@/backend/service/calendar/CalendarViewer";
import type { CalendarInviteeReference } from "@/definition/Calendar";
import type { User } from "@/definition/User";

/** An in-memory calendar with the people of the tests. */
export interface CalendarWorld {
  readonly service: CalendarService;
  readonly events: Map<string, CalendarEventRecord>;
  readonly exceptions: CalendarExceptionRecord[];
  readonly invitations: CalendarInvitationRecord[];
  readonly responses: CalendarResponseRecord[];
  readonly published: PagesEvent[];
  readonly pushed: {
    notice: CalendarInvitationNotice;
    userIds: readonly string[];
  }[];
  readonly user: (id: string) => User;
}

const ACCOUNTS: readonly CalendarAccountRecord[] = [
  { id: "ada", name: "Ada", isAgent: false, isActive: true },
  { id: "bob", name: "Bob", isAgent: false, isActive: true },
  { id: "cleo", name: "Cleo", isAgent: false, isActive: true },
  { id: "dan", name: "Dan", isAgent: false, isActive: true },
  { id: "admin", name: "Admin", isAgent: false, isActive: true },
  { id: "pica", name: "Pica", isAgent: true, isActive: true },
];

/** bob is in group "team", cleo in department "design", dan in project "p1". */
const GROUPS: Readonly<Record<string, readonly string[]>> = { team: ["bob"] };
const DEPARTMENTS: Readonly<Record<string, readonly string[]>> = {
  design: ["cleo"],
};
const PROJECTS: Readonly<Record<string, readonly string[]>> = {
  p1: ["ada", "dan"],
};

function isInvited(
  invitations: readonly CalendarInvitationRecord[],
  event: CalendarEventRecord,
  scope: CalendarViewerScope,
): boolean {
  return invitations.some(
    (entry) =>
      entry.eventId === event.id &&
      (((entry.kind === "person" || entry.kind === "agent") &&
        entry.inviteeId === scope.userId) ||
        (entry.kind === "group" && scope.groupIds.includes(entry.inviteeId)) ||
        (entry.kind === "department" &&
          scope.departmentIds.includes(entry.inviteeId))),
  );
}

function membersOf(
  table: Readonly<Record<string, readonly string[]>>,
  ids: readonly string[],
): { containerId: string; userId: string }[] {
  return ids.flatMap((id) =>
    (table[id] ?? []).map((userId) => ({ containerId: id, userId })),
  );
}

/**
 * Creates the in-memory calendar.
 *
 * @param timeZone - The zone of every account.
 */
export function createCalendarWorld(timeZone = "Europe/Berlin"): CalendarWorld {
  const events = new Map<string, CalendarEventRecord>();
  const exceptions: CalendarExceptionRecord[] = [];
  let invitations: CalendarInvitationRecord[] = [];
  let responses: CalendarResponseRecord[] = [];
  const operations = new Map<string, CalendarOperationRecord>();
  const published: PagesEvent[] = [];
  const pushed: CalendarWorld["pushed"] = [];
  const user = (id: string): User => ({
    id,
    username: id,
    displayName: id,
    role: id === "admin" ? "admin" : "employee",
    isActive: true,
    mustChangePassword: false,
    isAgent: id === "pica",
  });
  const store = (event: NewCalendarEvent, revision: number): void => {
    events.set(event.id, { ...event, revision, deletedAt: null });
  };
  const dependencies: CalendarDependencies = {
    events: {
      findById: async (id) => events.get(id) ?? null,
      findVisible: async (scope) =>
        [...events.values()].filter(
          (event) =>
            event.deletedAt === null &&
            (event.createdBy === scope.userId ||
              (event.projectId !== null &&
                scope.projectIds.includes(event.projectId)) ||
              isInvited(invitations, event, scope)),
        ),
      findExceptions: async (ids) =>
        exceptions.filter((entry) => ids.includes(entry.eventId)),
      insert: async (event) => store(event, 1),
      update: async (event) =>
        store(event, (events.get(event.id)?.revision ?? 0) + 1),
      touch: async (id) => {
        const event = events.get(id);
        if (event) events.set(id, { ...event, revision: event.revision + 1 });
      },
      markDeleted: async (id) => {
        const event = events.get(id);
        if (event)
          events.set(id, {
            ...event,
            deletedAt: "now",
            revision: event.revision + 1,
          });
      },
      saveException: async (exception) => {
        const index = exceptions.findIndex(
          (entry) =>
            entry.eventId === exception.eventId &&
            entry.occurrenceStart === exception.occurrenceStart,
        );
        if (index >= 0) exceptions.splice(index, 1);
        exceptions.push(exception);
      },
      deleteExceptions: async (eventId, options = {}) => {
        for (let index = exceptions.length - 1; index >= 0; index -= 1) {
          const entry = exceptions[index];
          if (
            entry !== undefined &&
            entry.eventId === eventId &&
            (options.fromOccurrence === undefined ||
              entry.occurrenceStart >= options.fromOccurrence)
          )
            exceptions.splice(index, 1);
        }
      },
    },
    participation: {
      findInvitations: async (ids) =>
        invitations.filter((entry) => ids.includes(entry.eventId)),
      replaceInvitations: async (
        eventId,
        list: readonly CalendarInviteeReference[],
      ) => {
        invitations = [
          ...invitations.filter((entry) => entry.eventId !== eventId),
          ...list.map((entry) => ({
            eventId,
            kind: entry.kind,
            inviteeId: entry.id,
          })),
        ];
      },
      findResponses: async (ids) =>
        responses.filter((entry) => ids.includes(entry.eventId)),
      saveResponse: async (record) => {
        responses = [
          ...responses.filter(
            (entry) =>
              !(
                entry.eventId === record.eventId &&
                entry.userId === record.userId
              ),
          ),
          record,
        ];
      },
      copyResponses: async (from, to) => {
        responses = [
          ...responses,
          ...responses
            .filter((entry) => entry.eventId === from)
            .map((entry) => ({ ...entry, eventId: to })),
        ];
      },
      reopenAcceptances: async (eventId) => {
        responses = responses.filter(
          (entry) =>
            !(entry.eventId === eventId && entry.response === "accepted"),
        );
      },
      isAffected: async () => true,
      findOperation: async (account, id) =>
        operations.get(`${account}:${id}`) ?? null,
      saveOperation: async (account, id, record) => {
        operations.set(`${account}:${id}`, record);
      },
    },
    directory: {
      findMemberships: async (userId) => ({
        groupIds: Object.keys(GROUPS).filter((id) =>
          GROUPS[id]?.includes(userId),
        ),
        departmentIds: Object.keys(DEPARTMENTS).filter((id) =>
          DEPARTMENTS[id]?.includes(userId),
        ),
      }),
      findAccounts: async (ids) =>
        ACCOUNTS.filter((account) => ids.includes(account.id)),
      findGroups: async (ids) =>
        ids
          .filter((id) => id in GROUPS)
          .map((id) => ({ id, name: `Gruppe ${id}` })),
      findDepartments: async (ids) =>
        ids
          .filter((id) => id in DEPARTMENTS)
          .map((id) => ({ id, name: `Abteilung ${id}` })),
      findGroupMembers: async (ids) => membersOf(GROUPS, ids),
      findDepartmentMembers: async (ids) => membersOf(DEPARTMENTS, ids),
      searchInvitees: async (text, limit) =>
        ACCOUNTS.filter((account) =>
          account.name.toLowerCase().includes(text.toLowerCase()),
        )
          .map((account) => ({
            kind: account.isAgent ? ("agent" as const) : ("person" as const),
            id: account.id,
            name: account.name,
          }))
          .slice(0, limit),
    },
    sources: {
      findProjectDates: async (ids) =>
        ids.includes("p1")
          ? [
              {
                id: "pd1",
                projectId: "p1",
                projectName: "Pages",
                title: "Release",
                description: "",
                date: "2026-11-12",
                time: "14:00",
              },
            ]
          : [],
      findDueTickets: async (assignee) =>
        assignee.userId === "ada"
          ? [
              {
                id: "t1",
                key: "PAGE-297",
                title: "Calendar",
                projectId: "p1",
                projectName: "Pages",
                date: "2026-11-10",
              },
            ]
          : [],
      findMilestones: async (ids) =>
        ids.includes("p1")
          ? [
              {
                id: "m1",
                name: "Version 1.0",
                description: "",
                projectId: "p1",
                projectName: "Pages",
                date: "2026-11-13",
              },
            ]
          : [],
      findProjectNames: async (ids) =>
        ids.map((id) => ({ id, name: `Projekt ${id}` })),
    },
    projects: {
      findAssigned: async (actor) =>
        Object.entries(PROJECTS)
          .filter(([, members]) => members.includes(actor.id))
          .map(([id]) => ({
            project: { id, name: "Pages" } as never,
            goalCount: 0,
            completedGoalCount: 0,
          })),
      canWriteProject: async (actor, projectId) =>
        PROJECTS[projectId]?.includes(actor.id) ?? false,
      workItemVisibility: async () => ({ departmentIds: null }),
    },
    permissions: { allows: async (actor) => actor.role === "admin" },
    settings: {
      getUserSettings: async () => ({
        language: "de",
        theme: "system",
        timezone: timeZone as never,
        dateFormat: "DD.MM.YYYY",
        weekStart: "monday",
        notifications: {
          email: true,
          desktop: true,
          mentions: true,
          assignments: true,
          dueDates: true,
          weeklySummary: false,
          calendarInvitations: true,
        },
      }),
    },
    publisher: {
      announce: async (work, decide) => {
        const result = await work();
        published.push(...decide(result));
        return result;
      },
      publish: (event) => {
        published.push(event);
      },
    },
    invitations: () => ({
      invited: async (notice, userIds) => {
        pushed.push({ notice, userIds });
      },
    }),
  };
  return {
    service: new CalendarService(dependencies),
    events,
    exceptions,
    get invitations() {
      return invitations;
    },
    get responses() {
      return responses;
    },
    published,
    pushed,
    user,
  };
}
