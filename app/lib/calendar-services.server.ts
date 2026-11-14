import { CalendarDirectoryRepository } from "@/backend/database/repositories/calendar/CalendarDirectoryRepository";
import { CalendarEventRepository } from "@/backend/database/repositories/calendar/CalendarEventRepository";
import { CalendarParticipationRepository } from "@/backend/database/repositories/calendar/CalendarParticipationRepository";
import { CalendarSourceRepository } from "@/backend/database/repositories/calendar/CalendarSourceRepository";
import { CalendarService } from "@/backend/service/calendar/CalendarService";
import { PicaMobileCalendarPush } from "@/backend/service/mobile/calendar/PicaMobileCalendarPush";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type { Database } from "@/backend/database/Database";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { SettingsService } from "@/backend/service/SettingsService";
import type { PicaMobileCalendarPushServices } from "@/backend/service/mobile/calendar/PicaMobileCalendarPush";

/** What the calendar is wired from. */
export interface CalendarServicesInput {
  readonly database: Database;
  readonly projectService: ProjectService;
  readonly permissionService: PermissionService;
  readonly settingsService: SettingsService;
  readonly events: PagesEventPublisher;
  /**
   * Resolves the push of Pica Mobile when an invitation goes out; the
   * notification services start after the calendar.
   */
  readonly push: () => Promise<PicaMobileCalendarPushServices>;
}

/**
 * Wires the calendar of PAGE-301 on the shared database: one service for
 * the interface, Pica Mobile, Pica and the MCP interface. Changes of the
 * project dates of a project reach the live view as `calendar.changed`.
 *
 * @param input - Database, project and permission services, settings,
 * publisher and the push of invitations.
 * @returns The calendar service.
 */
export function createCalendarService(
  input: CalendarServicesInput,
): CalendarService {
  const { database } = input;
  const push = new PicaMobileCalendarPush(input.push);
  const calendarService = new CalendarService({
    events: new CalendarEventRepository(database),
    participation: new CalendarParticipationRepository(database),
    directory: new CalendarDirectoryRepository(database),
    sources: new CalendarSourceRepository(database),
    projects: input.projectService,
    permissions: input.permissionService,
    settings: input.settingsService,
    publisher: input.events,
    invitations: () => push,
  });
  input.projectService.onDatesChanged((projectId) =>
    calendarService.announceProjectDates(projectId),
  );
  return calendarService;
}
