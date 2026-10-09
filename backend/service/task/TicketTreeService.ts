import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

import type { WorkItemTreeRepository } from "@/backend/database/repositories/task/WorkItemTreeRepository";
import type { TicketTreeEntry, WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

/**
 * A ticket id, or a group of the tree: a project or the tickets of a project
 * without a parent of the level above.
 */
const NODE_KEY_PATTERN =
  /^(?:(?:project|no-initiative|no-epic|no-task):)?[\w-]{1,64}$/;

/** Open branches kept per person; more are not stored. */
const MAXIMUM_EXPANDED_KEYS = 500;

/** The ticket read the tree needs; it applies the visibility of the actor. */
export interface TicketListSource {
  readonly findAll: (actor: User) => Promise<WorkItemDetail[]>;
}

function toEntry(item: WorkItemDetail): TicketTreeEntry {
  return {
    id: item.id,
    isDone: item.isDone,
    key: item.key,
    parentId: item.parentId,
    projectId: item.projectId,
    projectName: item.projectName,
    statusKey: item.statusKey,
    statusName: item.statusName,
    title: item.title,
    type: item.type,
  };
}

/**
 * Provides the ticket tree of the sidebar: the active tickets a person sees
 * and the branches the person opened (A8.2-E08).
 */
export class TicketTreeService {
  private readonly repository: WorkItemTreeRepository;
  private readonly tickets: TicketListSource;

  /**
   * Creates the service.
   *
   * @param repository - Keeps the open branches per person.
   * @param tickets - Reads the active tickets with the actor's visibility.
   */
  public constructor(
    repository: WorkItemTreeRepository,
    tickets: TicketListSource,
  ) {
    this.repository = repository;
    this.tickets = tickets;
  }

  /**
   * Lists the active tickets of the actor in the compact form of the tree.
   *
   * @param actor - The person looking.
   * @returns The tickets the board shows too, with their parents.
   */
  public async findEntries(actor: User): Promise<TicketTreeEntry[]> {
    return (await this.tickets.findAll(actor)).map(toEntry);
  }

  /**
   * Lists the branches the actor opened.
   *
   * @param actor - The person looking.
   * @returns Keys of the open branches.
   */
  public async findExpandedKeys(actor: User): Promise<string[]> {
    return this.repository.findExpandedKeys(actor.id);
  }

  /**
   * Opens or closes a branch for the actor.
   *
   * @param actor - The person.
   * @param nodeKey - Ticket id or group key.
   * @param isExpanded - Whether the branch is open now.
   * @throws {WorkItemValidationError} With `invalidTreeKey` for a key of an
   * unknown form.
   *
   * @remarks
   * Only the state is stored, never ticket data, so a key does not have to
   * name a visible ticket. Beyond the bound further branches stay closed.
   */
  public async setExpanded(
    actor: User,
    nodeKey: string,
    isExpanded: boolean,
  ): Promise<void> {
    if (!NODE_KEY_PATTERN.test(nodeKey)) {
      throw new WorkItemValidationError("invalidTreeKey");
    }

    if (
      isExpanded &&
      (await this.repository.countExpanded(actor.id)) >= MAXIMUM_EXPANDED_KEYS
    ) {
      return;
    }

    await this.repository.setExpanded(actor.id, nodeKey, isExpanded);
  }
}
