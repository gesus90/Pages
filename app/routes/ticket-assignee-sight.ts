import { z } from "zod";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { logCaughtError } from "@/backend/logging/Logger";

import type { TicketAssigneeSight } from "@/definition/Task";
import type { Route } from "./+types/ticket-assignee-sight";

const querySchema = z.object({
  departmentIds: z.array(z.string().min(1).max(200)).max(50),
  groupId: z.string().min(1).max(200).nullable(),
  personId: z.string().min(1).max(200).nullable(),
  ticketId: z.string().min(1).max(200).nullable(),
});

/**
 * Answers whether a person or group would see a ticket with its departments.
 *
 * @remarks
 * The departments of an existing ticket come from the ticket itself, so the
 * client cannot misstate them; a new ticket passes the departments it has chosen.
 */
export async function loader({
  context,
  request,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) return new Response("Forbidden", { status: 403 });
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    departmentIds: searchParams.getAll("departmentId"),
    groupId: searchParams.get("groupId"),
    personId: searchParams.get("personId"),
    ticketId: searchParams.get("ticketId"),
  });
  if (!parsed.success) return new Response("Bad Request", { status: 400 });
  const { departmentIds, groupId, personId, ticketId } = parsed.data;

  try {
    const services = await getApplicationServices();
    const stored =
      ticketId === null
        ? null
        : await services.taskService.getById(actor, ticketId);
    const sight: TicketAssigneeSight = await services.taskService.assigneeSight(
      actor,
      {
        departmentIds: stored?.departmentIds ?? departmentIds,
        groupId,
        personId,
      },
    );

    return Response.json(sight, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    logCaughtError("ticket_assignee_sight", error);

    return new Response("Not Found", { status: 404 });
  }
}
