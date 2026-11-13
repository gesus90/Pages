import type {
  CalendarAccountRecord,
  CalendarDirectoryRepository,
} from "@/backend/database/repositories/calendar/CalendarDirectoryRepository";
import type { CalendarEventRecord } from "@/backend/database/repositories/calendar/CalendarEventRepository";
import type {
  CalendarInvitationRecord,
  CalendarParticipationRepository,
  CalendarResponseRecord,
} from "@/backend/database/repositories/calendar/CalendarParticipationRepository";
import type {
  CalendarInvitee,
  CalendarPerson,
  CalendarPersonResponse,
  CalendarResponse,
} from "@/definition/Calendar";

/** Who an event concerns and how they answered. */
export interface CalendarParticipants {
  readonly invitees: readonly CalendarInvitee[];
  readonly responses: readonly CalendarPersonResponse[];
  /** Every affected account but the creator, members of groups and departments resolved. */
  readonly affectedIds: ReadonlySet<string>;
  readonly createdBy: CalendarPerson;
}

const NO_NAME = "—";

function groupBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}

/**
 * The invitees, answers and creators of a set of events, read together.
 *
 * @remarks
 * Groups and departments are resolved with their members of today: who
 * joins sees the event, who leaves no longer does. Agents always stay open.
 */
export class CalendarPeople {
  private readonly invitations: Map<string, CalendarInvitationRecord[]>;
  private readonly responses: Map<string, CalendarResponseRecord[]>;
  private readonly accounts: Map<string, CalendarAccountRecord>;
  private readonly groupNames: Map<string, string>;
  private readonly departmentNames: Map<string, string>;
  private readonly groupMembers: Map<string, string[]>;
  private readonly departmentMembers: Map<string, string[]>;

  private constructor(parts: {
    readonly invitations: readonly CalendarInvitationRecord[];
    readonly responses: readonly CalendarResponseRecord[];
    readonly accounts: readonly CalendarAccountRecord[];
    readonly groupNames: ReadonlyMap<string, string>;
    readonly departmentNames: ReadonlyMap<string, string>;
    readonly groupMembers: ReadonlyMap<string, string[]>;
    readonly departmentMembers: ReadonlyMap<string, string[]>;
  }) {
    this.invitations = groupBy(parts.invitations, (entry) => entry.eventId);
    this.responses = groupBy(parts.responses, (entry) => entry.eventId);
    this.accounts = new Map(parts.accounts.map((entry) => [entry.id, entry]));
    this.groupNames = new Map(parts.groupNames);
    this.departmentNames = new Map(parts.departmentNames);
    this.groupMembers = new Map(parts.groupMembers);
    this.departmentMembers = new Map(parts.departmentMembers);
  }

  /**
   * Reads the people of events.
   *
   * @param repositories - Participation and directory.
   * @param events - The events.
   */
  public static async read(
    repositories: {
      readonly participation: Pick<
        CalendarParticipationRepository,
        "findInvitations" | "findResponses"
      >;
      readonly directory: Pick<
        CalendarDirectoryRepository,
        | "findAccounts"
        | "findGroups"
        | "findDepartments"
        | "findGroupMembers"
        | "findDepartmentMembers"
      >;
    },
    events: readonly CalendarEventRecord[],
  ): Promise<CalendarPeople> {
    const { participation, directory } = repositories;
    const ids = events.map((event) => event.id);
    const invitations = await participation.findInvitations(ids);
    const responses = await participation.findResponses(ids);
    const idsOf = (kind: string): string[] => [
      ...new Set(
        invitations
          .filter((entry) => entry.kind === kind)
          .map((entry) => entry.inviteeId),
      ),
    ];
    const groupIds = idsOf("group");
    const departmentIds = idsOf("department");
    const groupMembers = await directory.findGroupMembers(groupIds);
    const departmentMembers = await directory.findDepartmentMembers(departmentIds);
    const accountIds = new Set([
      ...events.map((event) => event.createdBy),
      ...idsOf("person"),
      ...idsOf("agent"),
      ...groupMembers.map((entry) => entry.userId),
      ...departmentMembers.map((entry) => entry.userId),
    ]);
    const toMembers = (
      list: readonly { containerId: string; userId: string }[],
    ): Map<string, string[]> =>
      new Map(
        [...groupBy(list, (entry) => entry.containerId)].map(([key, value]) => [
          key,
          value.map((entry) => entry.userId),
        ]),
      );
    return new CalendarPeople({
      invitations,
      responses,
      accounts: await directory.findAccounts([...accountIds]),
      groupNames: new Map(
        (await directory.findGroups(groupIds)).map((entry) => [entry.id, entry.name]),
      ),
      departmentNames: new Map(
        (await directory.findDepartments(departmentIds)).map((entry) => [
          entry.id,
          entry.name,
        ]),
      ),
      groupMembers: toMembers(groupMembers),
      departmentMembers: toMembers(departmentMembers),
    });
  }

  /**
   * Returns the participants of one event.
   *
   * @param event - An event of the reading.
   */
  public of(event: CalendarEventRecord): CalendarParticipants {
    const invitations = this.invitations.get(event.id) ?? [];
    const invitees = invitations.flatMap((entry) => this.invitee(entry));
    const affectedIds = this.affected(event, invitations);
    const answers = new Map(
      (this.responses.get(event.id) ?? []).map((entry) => [
        entry.userId,
        entry.response,
      ]),
    );
    const responses = [...affectedIds]
      .flatMap((userId): CalendarPersonResponse[] => {
        const account = this.accounts.get(userId);
        if (!account) return [];
        const response: CalendarResponse = account.isAgent
          ? "open"
          : (answers.get(userId) ?? "open");
        return [{ userId, name: account.name, response }];
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    return {
      invitees,
      responses,
      affectedIds,
      createdBy: {
        id: event.createdBy,
        name: this.accounts.get(event.createdBy)?.name ?? NO_NAME,
      },
    };
  }

  /**
   * Tells whether an account is an agent.
   *
   * @param userId - The account.
   */
  public isAgent(userId: string): boolean {
    return this.accounts.get(userId)?.isAgent ?? false;
  }

  private invitee(entry: CalendarInvitationRecord): CalendarInvitee[] {
    const names: Readonly<Record<CalendarInvitationRecord["kind"], string | undefined>> = {
      group: this.groupNames.get(entry.inviteeId),
      department: this.departmentNames.get(entry.inviteeId),
      person: this.accounts.get(entry.inviteeId)?.name,
      agent: this.accounts.get(entry.inviteeId)?.name,
    };
    const name = names[entry.kind];
    return name === undefined
      ? []
      : [{ kind: entry.kind, id: entry.inviteeId, name }];
  }

  private affected(
    event: CalendarEventRecord,
    invitations: readonly CalendarInvitationRecord[],
  ): Set<string> {
    const ids = new Set<string>();
    for (const entry of invitations) {
      if (entry.kind === "person" || entry.kind === "agent") {
        if (this.accounts.get(entry.inviteeId)?.isActive) ids.add(entry.inviteeId);
      } else {
        const members =
          entry.kind === "group"
            ? this.groupMembers.get(entry.inviteeId)
            : this.departmentMembers.get(entry.inviteeId);
        for (const member of members ?? []) ids.add(member);
      }
    }
    ids.delete(event.createdBy);
    return ids;
  }
}
