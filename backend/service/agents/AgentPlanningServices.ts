import { AgentAssignmentTargetService } from "./AgentAssignmentTargetService";
import { AgentMilestoneService } from "./AgentMilestoneService";
import { AgentPlanningReadService } from "./AgentPlanningReadService";
import { AgentTicketAnnouncer } from "./AgentTicketAnnouncer";
import { AgentTicketLinkService } from "./AgentTicketLinkService";
import { AgentTicketSearchService } from "./AgentTicketSearchService";
import { AgentTicketService } from "./AgentTicketService";
import { AgentTicketTransaction } from "./AgentTicketTransaction";
import { AgentTicketTreeService } from "./AgentTicketTreeService";

import type { AgentChannel } from "@/backend/auth/McpActorContext";
import type { Database } from "@/backend/database/Database";
import type { UserService } from "@/backend/service/UserService";
import type { AgentTicketAnnouncerDependencies } from "./AgentTicketAnnouncer";

/** What the ticket and milestone operations of agents are built from. */
export interface AgentPlanningDependencies extends AgentTicketAnnouncerDependencies {
  readonly database: Database;
  readonly users: Pick<UserService, "getById">;
  /** The agent surface the operations run for; MCP when absent. */
  readonly channel?: AgentChannel;
}

/** The ticket and milestone operations of agents, ready to be dispatched. */
export interface AgentPlanningServices {
  readonly tickets: AgentTicketService;
  readonly milestones: AgentMilestoneService;
  readonly reads: AgentPlanningReadService;
  /** Finds tickets by text and filters. */
  readonly search: AgentTicketSearchService;
  /** Reads the hierarchy of a project or below a ticket. */
  readonly tree: AgentTicketTreeService;
  /** Reads and changes the typed links between tickets. */
  readonly links: AgentTicketLinkService;
  /** Names the persons, groups and departments tickets can be assigned to. */
  readonly targets: AgentAssignmentTargetService;
  /** Reacts to a committed change; callers that run inside their own transaction use it themselves. */
  readonly announcer: AgentTicketAnnouncer;
}

/**
 * Wires the ticket and milestone operations around one transaction runner.
 *
 * @param dependencies - The database, the account lookup and what reacts to a commit.
 * @returns Ticket writes, milestone writes and the reads they depend on.
 */
export function createAgentPlanningServices(
  dependencies: AgentPlanningDependencies,
): AgentPlanningServices {
  const shared = {
    transaction: new AgentTicketTransaction(
      dependencies.database,
      dependencies.channel,
    ),
    announcer: new AgentTicketAnnouncer(dependencies),
  };

  return {
    tickets: new AgentTicketService(shared),
    milestones: new AgentMilestoneService(shared),
    reads: new AgentPlanningReadService(dependencies),
    search: new AgentTicketSearchService(dependencies),
    tree: new AgentTicketTreeService(dependencies),
    links: new AgentTicketLinkService({ ...dependencies, ...shared }),
    targets: new AgentAssignmentTargetService(dependencies),
    announcer: shared.announcer,
  };
}
