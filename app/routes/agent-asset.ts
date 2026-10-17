import { Readable } from "node:stream";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { contentDisposition } from "@/app/lib/content-disposition";
import { getApplicationServices } from "@/app/lib/services.server";
import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";
import { isEmbeddableType } from "@/backend/service/wiki/WikiFileTypes";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/agent-asset";

/** Resolves a stable asset link through owner or linked-page visibility with the wiki download policy. */
export async function loader({
  context,
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  const { agentAssetService } = await getApplicationServices();
  try {
    const file = await agentAssetService.open(actor, params.assetId);
    const isInline =
      isEmbeddableType(file.contentType, "media") &&
      new URL(request.url).searchParams.get("download") !== "1";
    return new Response(Readable.toWeb(file.stream) as ReadableStream, {
      headers: {
        "Cache-Control": "private, no-cache",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; img-src 'self'; sandbox",
        "Content-Disposition": contentDisposition(
          isInline ? "inline" : "attachment",
          file.fileName,
        ),
        "Content-Type": file.contentType,
        "Content-Length": String(file.size),
      },
    });
  } catch (error: unknown) {
    logCaughtError("agent_asset", error);

    if (error instanceof WikiPageNotFoundError)
      throw new Response("Not Found", { status: 404 });
    throw error;
  }
}
