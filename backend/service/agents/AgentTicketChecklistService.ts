import { WorkItemChecklistRevisionRepository } from "@/backend/database/repositories/task/WorkItemChecklistRevisionRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import {
  materializeTicketChecklist,
  setDescriptionCheckbox,
} from "@/backend/service/task/TicketChecklist";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  applyChecklistMarkers,
  planChecklistWrites,
  readChecklistBatch,
} from "./AgentChecklistBatch";
import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";
import { createAgentTaskContext } from "./AgentTaskAccess";
import { translateAgentTicketError } from "./AgentTicketErrors";
import { agentTransactionScope } from "./AgentTransactionScope";
import { readAgentTicketReference } from "./AgentTicketValidation";

import type { AgentChannel } from "@/backend/auth/McpActorContext";
import type { Database } from "@/backend/database/Database";
import type { MaterializedChecklist } from "@/backend/service/task/TicketChecklist";
import type { UserService } from "@/backend/service/UserService";
import type {
  AgentChecklistItem,
  AgentChecklistItemChanged,
  AgentChecklistItemsChanged,
  AgentTicketChecklist,
} from "@/definition/AgentTicketChecklist";
import type { AgentTicketReference } from "@/definition/AgentTickets";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";
import type { ChecklistBatch, ChecklistWrites } from "./AgentChecklistBatch";
import type { AgentTaskContext } from "./AgentTaskAccess";
import type { AgentTicketAnnouncer } from "./AgentTicketAnnouncer";
import type {
  AgentTicketOutcome,
  AgentTicketTransaction,
} from "./AgentTicketTransaction";

/** The server-owned collaborators of checklist reads and changes. */
export interface AgentTicketChecklistDependencies {
  readonly database: Pick<Database, "transaction">;
  readonly users: Pick<UserService, "getById">;
  readonly transaction: AgentTicketTransaction;
  readonly announcer: AgentTicketAnnouncer;
  /** The agent surface the calls run for; MCP when absent. */
  readonly channel?: AgentChannel;
}

/** One validated change; the operation ID binds to exactly these values. */
interface ChecklistChange {
  readonly operationId: string;
  readonly ticket: AgentTicketReference;
  readonly itemId: string;
  readonly checked: boolean;
  readonly expectedRevision: string;
}

function readChecklistChange(input: unknown): ChecklistChange {
  const fields = readParameterRecord(input);
  requireParameterKeys(fields, [
    "operationId",
    "ticketId",
    "itemId",
    "checked",
    "expectedRevision",
  ]);
  if (typeof fields.checked !== "boolean")
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    operationId: readIdentifier(fields.operationId),
    ticket: readAgentTicketReference(fields.ticketId),
    itemId: readIdentifier(fields.itemId),
    checked: fields.checked,
    expectedRevision: readIdentifier(fields.expectedRevision),
  };
}

/** A visible ticket by identifier or key; a hidden one is reported as missing. */
async function requireTicket(
  context: AgentTaskContext,
  reference: AgentTicketReference,
): Promise<WorkItemDetail> {
  return "id" in reference
    ? context.tasks.getById(context.actor, reference.id)
    : context.tasks.getByKey(context.actor, reference.key);
}

async function readChecklist(
  context: AgentTaskContext,
  ticket: WorkItemDetail,
): Promise<MaterializedChecklist> {
  return materializeTicketChecklist(
    ticket.description,
    await context.tasks.findChecklistItems(context.actor, ticket.id),
  );
}

/** The revision store bound to the scope of the current call. */
function revisions(
  context: AgentTaskContext,
): WorkItemChecklistRevisionRepository {
  return new WorkItemChecklistRevisionRepository(context.database);
}

/**
 * Reads and sets the checkboxes of tickets for agents.
 *
 * @remarks
 * The ticket page and agents share one source: the acceptance criteria of
 * the ticket and the task list items of its description. Setting an entry
 * names the entry, the state and the revision that was read; it never
 * toggles, changes only that one entry and is refused when anything in the
 * checklist changed since the read. The operation ID makes a repeated call
 * return the stored result instead of applying it again.
 *
 * Setting several entries names the entries and states of the list that was
 * read. The whole request is validated first and applied in one transaction:
 * either every named entry reaches its state or nothing changes. Entries that
 * are not named, their texts and every other field of the ticket stay as they
 * are, and the result is the complete checklist with its new revision.
 */
export class AgentTicketChecklistService {
  private readonly dependencies: AgentTicketChecklistDependencies;

  public constructor(dependencies: AgentTicketChecklistDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads the checklist of one visible ticket.
   *
   * @param identity - The verified owner of the call.
   * @param parameters - The raw operation parameters: `ticketId` as identifier, key or address.
   * @returns The entries with identifiers, texts, states, order and nesting, and the revision.
   * @throws {AgentOperationError} `INVALID_REQUEST` or `NOT_FOUND`.
   */
  public async read(
    identity: AgentIdentity,
    parameters: unknown,
  ): Promise<PagesAgentReadResponse> {
    const fields = readParameterRecord(parameters);
    requireParameterKeys(fields, ["ticketId"]);
    const reference = readAgentTicketReference(fields.ticketId);
    const actor = await this.actor(identity);
    try {
      // The read may advance the stored revision, so it runs in one transaction.
      const result = await this.dependencies.database.transaction(
        async (transaction): Promise<AgentTicketChecklist> => {
          const context = createAgentTaskContext(
            agentTransactionScope(transaction),
            actor,
            this.dependencies.channel,
          );
          const ticket = await requireTicket(context, reference);
          const checklist = await readChecklist(context, ticket);
          const revision = await revisions(context).current(
            ticket.id,
            checklist.contentHash,
          );
          return {
            ticketId: ticket.id,
            key: ticket.key,
            link: `/tasks/${ticket.key}`,
            revision: String(revision),
            items: checklist.items,
          };
        },
      );
      return { apiVersion: "1", result };
    } catch (error: unknown) {
      logCaughtError("AgentTicketChecklistService", error);

      throw translateAgentTicketError(error);
    }
  }

  /**
   * Sets one entry to the requested state for the owner of a verified credential.
   *
   * @param identity - The verified owner of the call.
   * @param parameters - `operationId`, `ticketId`, `itemId`, `checked` and `expectedRevision`.
   * @returns The stored result; a repeated operation ID returns it unchanged.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `FORBIDDEN`, `NOT_FOUND` or `CONFLICT`.
   */
  public async set(
    identity: AgentIdentity,
    parameters: unknown,
  ): Promise<PagesAgentWriteResponse> {
    const change = readChecklistChange(parameters);
    const completed =
      await this.dependencies.transaction.run<AgentChecklistItemChanged>({
        userId: identity.userId,
        operation: "ticket.checklist.setItem",
        request: change,
        needsWriteRight: true,
        revisit: async (context, stored) => {
          await context.tasks.getById(context.actor, stored.ticketId);
        },
        work: (context) => this.apply(context, change),
      });
    this.dependencies.announcer.announce(completed);
    return { apiVersion: "1", result: completed.result };
  }

  /**
   * Sets several entries of one ticket to explicit states in one atomic change.
   *
   * @param identity - The verified owner of the call.
   * @param parameters - `operationId`, `ticketId`, `expectedRevision` and `items`, a list of `{itemId, checked}`.
   * @returns The complete checklist after the change with its new revision and how many entries changed; a repeated operation ID returns the stored result.
   * @throws {AgentOperationError} `INVALID_REQUEST` (with a reason for a bad entry list), `FORBIDDEN`, `NOT_FOUND` or `CONFLICT`.
   */
  public async setItems(
    identity: AgentIdentity,
    parameters: unknown,
  ): Promise<PagesAgentWriteResponse> {
    const batch = readChecklistBatch(parameters);
    const completed =
      await this.dependencies.transaction.run<AgentChecklistItemsChanged>({
        userId: identity.userId,
        operation: "ticket.checklist.setItems",
        request: batch,
        needsWriteRight: true,
        revisit: async (context, stored) => {
          await context.tasks.getById(context.actor, stored.ticketId);
        },
        work: (context) => this.applyBatch(context, batch),
      });
    this.dependencies.announcer.announce(completed);
    return { apiVersion: "1", result: completed.result };
  }

  private async applyBatch(
    context: AgentTaskContext,
    batch: ChecklistBatch,
  ): Promise<AgentTicketOutcome<AgentChecklistItemsChanged>> {
    const ticket = await requireTicket(context, batch.ticket);
    const checklist = await readChecklist(context, ticket);
    const revision = String(
      await revisions(context).current(ticket.id, checklist.contentHash),
    );
    if (revision !== batch.expectedRevision)
      throw new AgentOperationError("CONFLICT");
    // Every entry is resolved before the first write, so a bad one changes nothing.
    const writes = planChecklistWrites(checklist, batch.items);
    const changedCount = writes.criteria.length + writes.markers.length;
    if (changedCount === 0)
      return {
        result: this.listing(ticket, revision, checklist, 0),
        published: null,
        event: null,
      };
    const updated = await this.writeBatch(context, ticket, writes);
    const after = await readChecklist(context, updated);
    const next = await revisions(context).advance(ticket.id, after.contentHash);
    return {
      result: this.listing(updated, String(next), after, changedCount),
      // GitHub follows a changed description, like on the ticket page; it never sees the criteria.
      published: writes.markers.length > 0 ? updated : null,
      event: { type: "ticket.updated", id: ticket.id },
    };
  }

  private async writeBatch(
    context: AgentTaskContext,
    ticket: WorkItemDetail,
    writes: ChecklistWrites,
  ): Promise<WorkItemDetail> {
    const { actor, tasks } = context;
    for (const criterion of writes.criteria)
      await tasks.setChecklistItemDone(actor, criterion.id, criterion.isDone);
    if (writes.markers.length === 0) return tasks.getById(actor, ticket.id);
    return tasks.updateDescription(actor, ticket.id, {
      description: applyChecklistMarkers(ticket.description, writes.markers),
      baseDescription: ticket.description,
      // Nothing outside the checkbox characters may change, not even surrounding whitespace.
      isVerbatim: true,
    });
  }

  private listing(
    ticket: WorkItemDetail,
    revision: string,
    checklist: MaterializedChecklist,
    changedCount: number,
  ): AgentChecklistItemsChanged {
    return {
      ticketId: ticket.id,
      key: ticket.key,
      link: `/tasks/${ticket.key}`,
      revision,
      items: checklist.items,
      changedCount,
    };
  }

  private async apply(
    context: AgentTaskContext,
    change: ChecklistChange,
  ): Promise<AgentTicketOutcome<AgentChecklistItemChanged>> {
    const ticket = await requireTicket(context, change.ticket);
    const checklist = await readChecklist(context, ticket);
    const revision = String(
      await revisions(context).current(ticket.id, checklist.contentHash),
    );
    if (revision !== change.expectedRevision)
      throw new AgentOperationError("CONFLICT");
    const item = checklist.items.find((entry) => entry.id === change.itemId);
    if (!item) throw new AgentOperationError("NOT_FOUND");
    const unchanged = {
      ticketId: ticket.id,
      key: ticket.key,
      itemId: item.id,
      checked: change.checked,
    };
    if (item.checked === change.checked)
      return {
        result: { ...unchanged, changed: false, revision },
        published: null,
        event: null,
      };
    const updated = await this.write(context, ticket, checklist, {
      item,
      checked: change.checked,
    });
    const after = await readChecklist(context, updated);
    const next = await revisions(context).advance(ticket.id, after.contentHash);
    return {
      result: { ...unchanged, changed: true, revision: String(next) },
      // GitHub follows a changed description, like on the ticket page; it never sees the criteria.
      published: item.source === "description" ? updated : null,
      event: { type: "ticket.updated", id: ticket.id },
    };
  }

  private async write(
    context: AgentTaskContext,
    ticket: WorkItemDetail,
    checklist: MaterializedChecklist,
    target: { readonly item: AgentChecklistItem; readonly checked: boolean },
  ): Promise<WorkItemDetail> {
    const { actor, tasks } = context;
    if (target.item.source === "criteria") {
      const criterion = checklist.criteria.get(target.item.id);
      if (!criterion) throw new AgentOperationError("NOT_FOUND");
      await tasks.setChecklistItemDone(actor, criterion.id, target.checked);
      return tasks.getById(actor, ticket.id);
    }
    const offset = checklist.markers.get(target.item.id);
    if (offset === undefined) throw new AgentOperationError("NOT_FOUND");
    return tasks.updateDescription(actor, ticket.id, {
      description: setDescriptionCheckbox(
        ticket.description,
        offset,
        target.checked,
      ),
      baseDescription: ticket.description,
    });
  }

  private async actor(identity: AgentIdentity): Promise<User> {
    const actor = await this.dependencies.users.getById(identity.userId);
    if (!actor?.isActive || actor.mustChangePassword)
      throw new McpAuthorizationError("invalid_token", 401);
    return actor;
  }
}
