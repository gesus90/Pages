import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  describeUploadFailure,
  toUploadedFile,
} from "@/app/lib/wiki-actions/wiki-upload.server";

import type { Route } from "./+types/wiki-attachments";

/**
 * Takes a file for a page: `PUT /wiki-api/attachments?page=<id>&name=<name>`
 * with the file as the body of the request.
 *
 * @remarks
 * The body is streamed to the disk and counted while it arrives, so a file
 * above its limit stops early and leaves nothing behind, and no file is held
 * in memory as a whole. The answer is JSON.
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

  const { wikiService } = await getApplicationServices();
  const url = new URL(request.url);

  try {
    const attachment = await wikiService.uploadAttachment(
      actor,
      url.searchParams.get("page") ?? "",
      toUploadedFile(request, url.searchParams.get("name") ?? ""),
    );

    return Response.json({ attachment });
  } catch (error: unknown) {
    const failure = describeUploadFailure(error);

    if (failure === null) {
      throw error;
    }

    return Response.json({ error: failure.error }, { status: failure.status });
  }
}
