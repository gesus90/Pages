import { logCaughtError } from "@/backend/logging/Logger";

import type {
  PagesEvent,
  PagesEventAudience,
} from "@/backend/service/events/PagesEventPublisher";
import type { LiveChange, LiveChangeKind } from "@/definition/LiveChange";
import type {
  Milestone,
  MilestoneReadOptions,
  WorkItemDetail,
  WorkItemVisibility,
} from "@/definition/Task";
import type { Project } from "@/definition/Project";
import type { User } from "@/definition/User";

/** The reads that decide whether an account sees the object of an event. */
export interface LiveChangeAudienceDependencies {
  readonly tickets: {
    getById(actor: User, id: string): Promise<WorkItemDetail>;
  };
  readonly milestones: {
    findMilestoneById(
      id: string,
      options?: MilestoneReadOptions,
    ): Promise<Milestone | null>;
  };
  readonly projects: {
    getById(actor: User, projectId: string): Promise<Project>;
    workItemVisibility(actor: User): Promise<WorkItemVisibility>;
  };
  readonly wiki: {
    canView(actor: User, id: string): Promise<boolean>;
  };
  /** Whether an account is a member of a conversation (PAGE-278). */
  readonly conversations: {
    isMember(actor: User, conversationId: string): Promise<boolean>;
  };
}

/**
 * Events about objects that may have left somebody's sight: they become a
 * `resync`, which names nothing, since the rights before the change are gone.
 */
const RESYNC_EVENTS: ReadonlySet<PagesEvent["type"]> = new Set([
  "wiki.page.purged",
  "project.access.changed",
]);

/**
 * Tells whether an event makes every open page read everything again.
 *
 * @param type - The kind of a committed event.
 * @returns `true` for a purged page or a project whose access changed.
 */
export function isResyncEvent(type: PagesEvent["type"]): boolean {
  return RESYNC_EVENTS.has(type);
}

function kindOf(type: PagesEvent["type"]): LiveChangeKind | null {
  if (type.startsWith("ticket.")) return "ticket";
  if (type.startsWith("milestone.")) return "milestone";
  if (type.startsWith("wiki.")) return "wiki";
  if (type === "project.tickets.changed") return "project";
  if (type === "conversation.changed") return "conversation";
  // A linked asset always arrives with the page that links it.
  return null;
}

function departmentAllows(
  visibility: WorkItemVisibility,
  audience: PagesEventAudience,
): boolean {
  if (visibility.departmentIds === null || audience.departmentIds.length === 0)
    return true;
  const own = visibility.departmentIds;
  return audience.departmentIds.some((id) => own.includes(id));
}

/**
 * Decides per account and per event whether a live notice may go out.
 *
 * @remarks
 * Every decision reads the current rights of the current account through the
 * same services the pages read with; nothing is remembered between events,
 * so a revoked right holds back the very next notice. A failed read counts as
 * "not visible".
 */
export class LiveChangeAudience {
  private readonly dependencies: LiveChangeAudienceDependencies;

  /**
   * Creates the audience check.
   *
   * @param dependencies - The rights-checked reads of tickets, milestones, projects and pages.
   */
  public constructor(dependencies: LiveChangeAudienceDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Returns the notice an account may receive for an event, or `null`.
   *
   * @param actor - The account as it is now.
   * @param event - A committed Pages event.
   */
  public async notice(
    actor: User,
    event: PagesEvent,
  ): Promise<LiveChange | null> {
    const kind = kindOf(event.type);
    if (!kind) return null;
    try {
      return (await this.canSee(actor, kind, event))
        ? { kind, id: event.id }
        : null;
    } catch (caughtError: unknown) {
      logCaughtError("LiveChangeAudience", caughtError);
      return null;
    }
  }

  private async canSee(
    actor: User,
    kind: LiveChangeKind,
    event: PagesEvent,
  ): Promise<boolean> {
    if (kind === "wiki") return this.dependencies.wiki.canView(actor, event.id);
    if (kind === "conversation")
      return this.dependencies.conversations.isMember(actor, event.id);
    if (kind === "milestone") return this.canSeeMilestone(actor, event.id);
    if (kind === "project") {
      await this.dependencies.projects.getById(actor, event.id);
      return true;
    }
    if (event.audience) return this.couldSeeTicket(actor, event.audience);
    await this.dependencies.tickets.getById(actor, event.id);
    return true;
  }

  private async canSeeMilestone(actor: User, id: string): Promise<boolean> {
    const milestone = await this.dependencies.milestones.findMilestoneById(id, {
      includeArchived: true,
    });
    if (!milestone) return false;
    await this.dependencies.projects.getById(actor, milestone.projectId);
    return true;
  }

  /** The ticket read rule of a deleted row: project access and department. */
  private async couldSeeTicket(
    actor: User,
    audience: PagesEventAudience,
  ): Promise<boolean> {
    const visibility =
      await this.dependencies.projects.workItemVisibility(actor);
    if (!departmentAllows(visibility, audience)) return false;
    if (
      visibility.projectIds &&
      !visibility.projectIds.includes(audience.projectId)
    )
      return false;
    await this.dependencies.projects.getById(actor, audience.projectId);
    return true;
  }
}
