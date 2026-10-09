import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { describeTicketUploadFailure } from "@/app/lib/task-actions/ticket-upload.server";
import { toUploadedFile } from "@/app/lib/wiki-actions/wiki-upload.server";

import type { Route } from "./+types/ticket-attachments";

/**
 * Takes a file for a ticket: `PUT /aufgaben-api/attachments?ticket=<id>&name=<name>`
 * with the file as the body of the request (A8.2-E06).
 *
 * @remarks
 * Like wiki uploads, the body is streamed to the disk and counted while it
 * arrives; the answer is JSON with the attachment or an error code.
 */
export async function action({
  context,
  request,
}: Route.ActionArgs): Promise<Response> {
  if (request.method !== "PUT") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "PUT" },
      status: 405,
    });
  }

  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Response("Forbidden", { status: 403 });
  }

  const { taskAttachmentService } = await getApplicationServices();
  const url = new URL(request.url);

  try {
    const attachment = await taskAttachmentService.upload(
      actor,
      url.searchParams.get("ticket") ?? "",
      toUploadedFile(request, url.searchParams.get("name") ?? ""),
    );

    return Response.json({ attachment });
  } catch (error: unknown) {
    const failure = describeTicketUploadFailure(error);

    if (failure === null) {
      throw error;
    }

    return Response.json({ error: failure.error }, { status: failure.status });
  }
}
