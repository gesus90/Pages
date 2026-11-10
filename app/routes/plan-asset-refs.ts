import { Readable } from "node:stream";

import { getApplicationServices } from "@/app/lib/services.server";
import { contentDisposition } from "@/app/lib/content-disposition";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/plan-asset-refs";

/**
 * Hands a runner the file of a plan asset reference:
 * `GET /api/v1/plan-asset-references` with `X-Pages-Asset-Reference`.
 *
 * @remarks
 * The reference is the only credential: it is signed, short-lived, names
 * one file, and is redeemed with the rights of the person the run belongs
 * to. The file is always a download; nothing is rendered. It is streamed from
 * the store, so a file of any size up to the plan limit costs no memory.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  const reference = request.headers.get("X-Pages-Asset-Reference") ?? "";
  const { agentPlanAssetReferences } = await getApplicationServices();
  if (!agentPlanAssetReferences || !reference)
    return Response.json(
      { error: "plan_asset_runner_denied" },
      { status: 403 },
    );
  try {
    const file = await agentPlanAssetReferences.redeem(reference);
    return new Response(Readable.toWeb(file.stream) as ReadableStream, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Length": String(file.size),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": contentDisposition("attachment", file.fileName),
        "Content-Type": "application/octet-stream",
        "X-Pages-Media-Type": file.mediaType,
      },
    });
  } catch (error: unknown) {
    logCaughtError("plan_asset_references", error);
    const code =
      error instanceof AgentError ? error.code : "plan_asset_runner_denied";
    return Response.json({ error: code }, { status: 403 });
  }
}
