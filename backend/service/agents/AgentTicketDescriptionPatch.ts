import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { WORK_ITEM_LIMITS } from "@/definition/Task";

import { agentTextVersion, applyTextPatch, indexText } from "./AgentTextRange";
import { agentTicketLink, requireAgentTicket } from "./AgentTicketLookup";

import type { AgentTicketDescriptionPatchInput } from "@/definition/AgentTickets";
import type { AgentTicketDescriptionPatched } from "@/definition/AgentTickets";
import type { AgentTaskContext } from "./AgentTaskAccess";
import type { AgentTicketOutcome } from "./AgentTicketTransaction";

/**
 * Replaces one range of the description of a ticket.
 *
 * @param context - The services of the call, bound to its transaction and account.
 * @param request - The ticket, the version the range was read at and the range.
 * @returns What the call changed, to be announced after the commit.
 * @throws {AgentOperationError} `CONFLICT` for another version or other range text,
 * `INVALID_REQUEST` for an unusable position, `PAYLOAD_TOO_LARGE` for a result over the limit.
 *
 * @remarks
 * The version is compared with the stored description inside the transaction
 * that writes, and the write itself only succeeds while the description is
 * still the one the range was cut from. The result is stored exactly as
 * composed: trimming it, as a full replacement does, would change text
 * outside the range. A call that leaves the text as it is writes no history.
 */
export async function patchAgentTicketDescription(
  context: AgentTaskContext,
  request: AgentTicketDescriptionPatchInput,
): Promise<AgentTicketOutcome<AgentTicketDescriptionPatched>> {
  const existing = await requireAgentTicket(context, request.ticket);
  if (agentTextVersion(existing.description) !== request.expectedVersion)
    throw new AgentOperationError("CONFLICT", { reason: "text_changed" });
  const patched = applyTextPatch(indexText(existing.description), request);
  if (patched.text.length > WORK_ITEM_LIMITS.descriptionLength)
    throw new AgentOperationError("PAYLOAD_TOO_LARGE", {
      constraint: "ticketDescriptionUtf16Units",
      limit: WORK_ITEM_LIMITS.descriptionLength,
    });
  const stored = await context.tasks.updateDescription(
    context.actor,
    existing.id,
    {
      description: patched.text,
      baseDescription: existing.description,
      isVerbatim: true,
    },
  );
  const hasChanged = stored.description !== existing.description;
  return {
    result: {
      ticketId: existing.id,
      key: existing.key,
      link: agentTicketLink(existing.key),
      field: "description",
      changed: hasChanged,
      descriptionVersion: agentTextVersion(stored.description),
      start: patched.start,
      end: patched.end,
      ...(patched.after === undefined ? {} : { after: patched.after }),
    },
    published: hasChanged ? stored : null,
    event: hasChanged ? { type: "ticket.updated", id: existing.id } : null,
  };
}
