import {
  readDraftRequest,
  runDraftWrite,
} from "@/app/lib/drafts/draft-request.server";
import { descriptionContentSchema } from "@/definition/BackgroundSave";
import {
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";
import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";

import type { Route } from "./+types/ticket-draft";

/** Saves only the description using the service's atomic text comparison. */
export async function action(args: Route.ActionArgs): Promise<Response> {
  const { actor, services, base, draft, streamId, sequence } =
    await readDraftRequest(args, descriptionContentSchema);
  return runDraftWrite(
    {
      actorId: actor.id,
      objectId: `ticket:${args.params.ticketId}`,
      streamId,
      sequence,
    },
    async () => {
      try {
        const ticket = await services.taskService.updateDescription(
          actor,
          args.params.ticketId,
          {
            baseDescription: base.description,
            description: draft.description,
          },
        );
        return Response.json({
          ok: true,
          saved: descriptionContentSchema.parse(ticket),
        });
      } catch (error: unknown) {
        if (error instanceof WorkItemValidationError) {
          const current =
            error.code === "descriptionConflict"
              ? await services.taskService.getById(actor, args.params.ticketId)
              : undefined;
          return Response.json(
            {
              ok: false,
              error: error.code,
              current: current
                ? descriptionContentSchema.parse(current)
                : undefined,
            },
            { status: current ? 409 : 400 },
          );
        }
        if (error instanceof WorkItemNotFoundError) {
          return Response.json(
            { ok: false, error: "notFound" },
            { status: 404 },
          );
        }
        if (
          error instanceof WorkItemAccessDeniedError ||
          error instanceof ProjectAccessDeniedError
        ) {
          return Response.json(
            { ok: false, error: "forbidden" },
            { status: 403 },
          );
        }
        throw error;
      }
    },
  );
}
