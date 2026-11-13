import { PERMISSION } from "@/definition/Role";

import { isKnownTimeZone, serverTimeZone } from "./CalendarTime";

import type { CalendarDirectoryRepository } from "@/backend/database/repositories/calendar/CalendarDirectoryRepository";
import type { CalendarEventRepository } from "@/backend/database/repositories/calendar/CalendarEventRepository";
import type { CalendarParticipationRepository } from "@/backend/database/repositories/calendar/CalendarParticipationRepository";
import type { CalendarSourceRepository } from "@/backend/database/repositories/calendar/CalendarSourceRepository";
import type { PermissionService } from "@/backend/auth/PermissionService";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { SettingsService } from "@/backend/service/SettingsService";
import type { Language } from "@/language/Language";
import type { User } from "@/definition/User";

/**
 * What a new invitation tells the push of the app.
 *
 * @remarks
 * `startAt` is stored UTC text of a timed event or the first date of an
 * all-day event; the push formats it in the zone and language of each
 * recipient.
 */
export interface CalendarInvitationNotice {
  readonly eventId: string;
  readonly title: string;
  readonly startAt: string;
  readonly allDay: boolean;
  readonly creatorId: string;
  readonly creatorName: string;
}

/** Hears of accounts newly invited to an event, after the change committed. */
export interface CalendarInvitationListener {
  invited(
    notice: CalendarInvitationNotice,
    userIds: readonly string[],
  ): Promise<void>;
}

/** The repositories and services the calendar is built from. */
export interface CalendarDependencies {
  readonly events: Pick<
    CalendarEventRepository,
    | "findById"
    | "findVisible"
    | "findExceptions"
    | "insert"
    | "update"
    | "touch"
    | "markDeleted"
    | "saveException"
    | "deleteExceptions"
  >;
  readonly participation: Pick<
    CalendarParticipationRepository,
    | "findInvitations"
    | "replaceInvitations"
    | "findResponses"
    | "saveResponse"
    | "copyResponses"
    | "reopenAcceptances"
    | "isAffected"
    | "findOperation"
    | "saveOperation"
  >;
  readonly directory: Pick<
    CalendarDirectoryRepository,
    | "findMemberships"
    | "findAccounts"
    | "findGroups"
    | "findDepartments"
    | "findGroupMembers"
    | "findDepartmentMembers"
    | "searchInvitees"
  >;
  readonly sources: Pick<
    CalendarSourceRepository,
    | "findProjectDates"
    | "findDueTickets"
    | "findMilestones"
    | "findProjectNames"
  >;
  readonly projects: Pick<
    ProjectService,
    "findAssigned" | "canWriteProject" | "workItemVisibility"
  >;
  readonly permissions: Pick<PermissionService, "allows">;
  readonly settings: Pick<SettingsService, "getUserSettings">;
  readonly publisher: Pick<PagesEventPublisher, "announce" | "publish">;
  /** Optional: the push of new invitations; without it nobody is pushed. */
  readonly invitations?: () => CalendarInvitationListener | null;
}

/** One member project of the viewer. */
export interface CalendarProjectRef {
  readonly id: string;
  readonly name: string;
}

/**
 * The account a calendar request runs for, with its current memberships.
 *
 * @remarks
 * Read anew for every request, so a left group, department or project hides
 * its events at once.
 */
export interface CalendarViewer {
  readonly user: User;
  readonly timeZone: string;
  readonly language: Language;
  readonly groupIds: readonly string[];
  readonly departmentIds: readonly string[];
  readonly projects: readonly CalendarProjectRef[];
  readonly isAdmin: boolean;
}

/**
 * Tells the zone an account sees times in: its own setting, or the server's.
 *
 * @param settings - The settings service.
 * @param userId - The account.
 */
export async function readCalendarTimeZone(
  settings: Pick<SettingsService, "getUserSettings">,
  userId: string,
): Promise<string> {
  const { timezone } = await settings.getUserSettings(userId);
  return timezone !== null && isKnownTimeZone(timezone)
    ? timezone
    : serverTimeZone();
}

/**
 * Reads the viewer of a request.
 *
 * @param dependencies - Repositories and services.
 * @param user - The signed-in account.
 */
export async function readCalendarViewer(
  dependencies: CalendarDependencies,
  user: User,
): Promise<CalendarViewer> {
  const settings = await dependencies.settings.getUserSettings(user.id);
  const memberships = await dependencies.directory.findMemberships(user.id);
  const assigned = await dependencies.projects.findAssigned(user);
  const isAdmin = await dependencies.permissions.allows(
    user,
    PERMISSION.MANAGE_APPLICATION,
  );
  return {
    user,
    timeZone:
      settings.timezone !== null && isKnownTimeZone(settings.timezone)
        ? settings.timezone
        : serverTimeZone(),
    language: settings.language,
    groupIds: memberships.groupIds,
    departmentIds: memberships.departmentIds,
    projects: assigned.map(({ project }) => ({
      id: project.id,
      name: project.name,
    })),
    isAdmin,
  };
}
