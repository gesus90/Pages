import { createHash } from "node:crypto";

import { logCaughtError } from "@/backend/logging/Logger";

import { McpTicketError, toMcpTicketError } from "./McpTicketError";
import { McpTicketLifecycleService } from "./McpTicketLifecycleService";

import type { WorkItemDetail } from "@/definition/Task";
import type { McpTicketReference } from "./McpTicketContract";
import type { McpTicketContext } from "./McpTicketContext";

/** What a preview finds out about one requested ticket. */
export type ArchiveSelectionVerdict =
  | "archivable"
  | "alreadyArchived"
  | "unfinishedDescendants"
  | "forbidden"
  | "notFound";

/** One requested ticket in a preview. */
export interface ArchiveSelectionEntry {
  /** The reference exactly as it was requested. */
  readonly requested: string;
  readonly ticket: McpTicketReference | null;
  readonly verdict: ArchiveSelectionVerdict;
  /** Active descendants that go along with the ticket. */
  readonly affected: readonly McpTicketReference[];
  /** Descendants that are not done; the ticket is then left unchanged. */
  readonly unfinished: readonly McpTicketReference[];
}

/** The question a preview returns; nothing was changed. */
export interface ArchiveSelectionPreview {
  readonly confirmationRequired: true;
  /** Binds the confirmed call to exactly this selection and its state. */
  readonly selectionToken: string;
  readonly requested: number;
  readonly archivable: number;
  readonly tickets: readonly ArchiveSelectionEntry[];
}

/** The outcome for one requested ticket after the confirmed call. */
export interface ArchiveSelectionOutcome {
  readonly requested: string;
  readonly ticket: McpTicketReference | null;
  readonly outcome: "archived" | "skipped" | "failed";
  /** Tickets newly archived for this entry, its descendants included. */
  readonly archived: number;
  /** The unchanged error code of a failed entry. */
  readonly error?: string;
}

/** The result of a confirmed call; the counts add up to `requested`. */
export interface ArchiveSelectionResult {
  readonly requested: number;
  readonly succeeded: number;
  readonly skipped: number;
  readonly failed: number;
  /** All tickets newly archived across the selection, descendants included. */
  readonly archived: number;
  readonly tickets: readonly ArchiveSelectionOutcome[];
}

/** A requested ticket as read right now, with the state the token binds. */
interface Inspection {
  readonly entry: ArchiveSelectionEntry;
  readonly ticketId: string | null;
  readonly state: readonly unknown[];
}

/** What the selection looks like right now. */
interface CurrentSelection {
  readonly inspections: readonly Inspection[];
  readonly token: string;
}

const COMPONENT = "McpTicketArchiveSelectionService";

/** The error code the chat reports for a verdict that archives nothing. */
const VERDICT_ERROR: Readonly<Record<ArchiveSelectionVerdict, string>> = {
  archivable: "FAILED",
  alreadyArchived: "ALREADY_ARCHIVED",
  unfinishedDescendants: "UNFINISHED_DESCENDANTS",
  forbidden: "FORBIDDEN",
  notFound: "NOT_FOUND",
};

function referenceOf(item: WorkItemDetail): McpTicketReference {
  return { key: item.key, title: item.title };
}

function describeInspection(
  requested: string,
  ticket: WorkItemDetail | null,
  verdict: ArchiveSelectionVerdict,
  descendants: readonly WorkItemDetail[] = [],
): Inspection {
  const unfinished = descendants.filter((item) => !item.isDone);
  return {
    ticketId: ticket?.id ?? null,
    entry: {
      requested,
      ticket: ticket === null ? null : referenceOf(ticket),
      verdict,
      affected: descendants.map(referenceOf),
      unfinished: unfinished.map(referenceOf),
    },
    // Status and archive state of the ticket and its descendants decide
    // whether the same selection is still the one that was shown.
    state: [
      requested,
      ticket?.id ?? null,
      ticket?.statusId ?? null,
      ticket === null ? null : ticket.archivedAt !== null,
      verdict,
      descendants
        .map((item) => [item.id, item.statusId])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    ],
  };
}

/**
 * Archives a list of tickets chosen beforehand, after the person confirmed
 * exactly that list.
 * @remarks
 * Each ticket is archived with its own rights check and in its own
 * database step: a failure of one ticket never undoes another, and the
 * result names every ticket with its outcome. A ticket with descendants
 * that are not done is never archived silently; the preview reports it
 * and the confirmed call leaves it unchanged.
 */
export class McpTicketArchiveSelectionService {
  private readonly lifecycle = new McpTicketLifecycleService();

  /**
   * Reads the selection and describes what archiving it would change.
   * @param context - The request; its account is the actor.
   * @param references - Keys or ids of the tickets, without duplicates.
   * @returns The question with the token a confirmed call must repeat.
   * @throws {McpTicketError} `invalid_request` for a ticket named twice.
   */
  public async preview(
    context: McpTicketContext,
    references: readonly string[],
  ): Promise<ArchiveSelectionPreview> {
    const { inspections, token } = await this.inspectAll(context, references);
    return {
      confirmationRequired: true,
      selectionToken: token,
      requested: inspections.length,
      archivable: inspections.filter(
        ({ entry }) => entry.verdict === "archivable",
      ).length,
      tickets: inspections.map(({ entry }) => entry),
    };
  }

  /**
   * Archives the selection the person confirmed.
   * @param context - The request; its account is the actor.
   * @param references - The same tickets in the same order as the preview.
   * @param selectionToken - The token of that preview.
   * @returns One outcome per ticket and the verifiable totals.
   * @throws {McpTicketError} `conflict` when the selection, a status, an
   * archive state or a right changed since the preview; nothing was
   * changed and a new preview is needed. `invalid_request` for a ticket
   * named twice.
   */
  public async archive(
    context: McpTicketContext,
    references: readonly string[],
    selectionToken: string,
  ): Promise<ArchiveSelectionResult> {
    const { inspections, token } = await this.inspectAll(context, references);
    // A repeated call finds its tickets archived, so the token no longer
    // matches and nothing is archived twice.
    if (token !== selectionToken) throw new McpTicketError("conflict");
    const tickets: ArchiveSelectionOutcome[] = [];
    for (const inspection of inspections)
      tickets.push(await this.archiveOne(context, inspection));
    const count = (outcome: ArchiveSelectionOutcome["outcome"]): number =>
      tickets.filter((item) => item.outcome === outcome).length;
    return {
      requested: tickets.length,
      succeeded: count("archived"),
      skipped: count("skipped"),
      failed: count("failed"),
      archived: tickets.reduce((total, item) => total + item.archived, 0),
      tickets,
    };
  }

  private async inspectAll(
    context: McpTicketContext,
    references: readonly string[],
  ): Promise<CurrentSelection> {
    const inspections: Inspection[] = [];
    for (const reference of references)
      inspections.push(await this.inspect(context, reference));
    const ids = inspections.flatMap(({ ticketId }) =>
      ticketId === null ? [] : [ticketId],
    );
    if (new Set(ids).size !== ids.length)
      throw new McpTicketError("invalid_request");
    const states = inspections
      .map(({ state }) => state)
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      );
    const token = createHash("sha256")
      .update(JSON.stringify([context.actor.id, states]))
      .digest("hex");
    return { inspections, token };
  }

  private async inspect(
    context: McpTicketContext,
    reference: string,
  ): Promise<Inspection> {
    let ticket: WorkItemDetail;
    try {
      ticket = await context.ticket(reference);
    } catch (error: unknown) {
      const code = toMcpTicketError(error)?.code;
      if (code === "not_found")
        return describeInspection(reference, null, "notFound");
      if (code === "forbidden")
        return describeInspection(reference, null, "forbidden");
      throw error;
    }
    const { canArchive } = await context.services.tasks.describeDescendants(
      context.actor,
      ticket.id,
    );
    if (!canArchive) return describeInspection(reference, ticket, "forbidden");
    if (ticket.archivedAt !== null)
      return describeInspection(reference, ticket, "alreadyArchived");
    const scope = await this.lifecycle.archiveScope(context, ticket);
    const descendants = scope.filter((item) => item.id !== ticket.id);
    const hasUnfinished = descendants.some((item) => !item.isDone);
    return describeInspection(
      reference,
      ticket,
      hasUnfinished ? "unfinishedDescendants" : "archivable",
      descendants,
    );
  }

  private async archiveOne(
    context: McpTicketContext,
    { entry, ticketId }: Inspection,
  ): Promise<ArchiveSelectionOutcome> {
    const base = { requested: entry.requested, ticket: entry.ticket };
    if (entry.verdict === "alreadyArchived")
      return { ...base, outcome: "skipped", archived: 0 };
    if (entry.verdict !== "archivable" || ticketId === null)
      return {
        ...base,
        outcome: "failed",
        archived: 0,
        error: VERDICT_ERROR[entry.verdict],
      };
    try {
      const archived = await context.services.tasks.archive(
        context.actor,
        ticketId,
        "include",
      );
      // Nothing changed when an earlier ticket of the list already took it along.
      return {
        ...base,
        outcome: archived > 0 ? "archived" : "skipped",
        archived,
      };
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
      const code = toMcpTicketError(error)?.code.toUpperCase();
      return {
        ...base,
        outcome: "failed",
        archived: 0,
        error: code ?? "FAILED",
      };
    }
  }
}
