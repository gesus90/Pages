import { Readable } from "node:stream";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { contentDisposition } from "@/app/lib/content-disposition";
import { getApplicationServices } from "@/app/lib/services.server";
import { AgentError } from "@/backend/error/AgentErrors";
import { isPlanAssetPreviewable } from "@/definition/AgentPlanAsset";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/agent-plan-asset";

/**
 * Serves the bytes of a plan asset to a person who may read its project.
 *
 * @remarks
 * Only types a browser shows without running anything are served inline,
 * and always under a sandbox policy without scripts, so an SVG or a PDF
 * opened on its own executes nothing. Every other file, and every file with
 * `?download=1`, is a download. The type is the one the server detected.
 */
export async function loader({
  context,
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  const user = context.get(authenticatedUserContext);
  if (!user) throw new Response("Forbidden", { status: 403 });
  const { agentPlanAssetService } = await getApplicationServices();
  if (!agentPlanAssetService) throw new Response("Not Found", { status: 404 });
  try {
    const { record, stream } = await agentPlanAssetService.open(
      user.id,
      params.assetId,
    );
    const isInline =
      isPlanAssetPreviewable(record) &&
      new URL(request.url).searchParams.get("download") !== "1";
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Cache-Control": "private, no-cache",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
        "Content-Disposition": contentDisposition(
          isInline ? "inline" : "attachment",
          record.fileName,
        ),
        "Content-Type": isInline
          ? record.mediaType
          : "application/octet-stream",
        "Content-Length": String(record.size),
      },
    });
  } catch (error: unknown) {
    logCaughtError("agent_plan_asset", error);
    if (error instanceof AgentError && error.code === "plan_asset_missing")
      throw new Response("Not Found", { status: 404 });
    if (error instanceof AgentError && error.code === "plan_asset_unreadable")
      throw new Response("Gone", { status: 410 });
    throw error;
  }
}
