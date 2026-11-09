import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { toUploadedFile } from "@/app/lib/wiki-actions/wiki-upload.server";
import { readPlanText } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { PlanAssetService } from "@/backend/service/agents/assets/PlanAssetService";
import type { Route } from "./+types/agent-plan-assets";

async function planAssets(): Promise<PlanAssetService> {
  const { agentPlanAssetService } = await getApplicationServices();
  if (!agentPlanAssetService)
    throw new AgentError("parameter_asset_transfer_unsupported");
  return agentPlanAssetService;
}

/**
 * Describes a plan asset: `GET /agent-api/plan-assets?id=<asset>`.
 *
 * @remarks
 * Answers whether the person may still read it and whether its bytes are
 * still there, so a reopened plan shows a missing or unreadable file at once.
 * No content is sent.
 */
export async function loader({
  context,
  request,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const assetId = readPlanText(new URL(request.url).searchParams.get("id"));
    const service = await planAssets();
    const asset = await service.describe(user.id, assetId);
    const isReadable = await service.isReadable(user.id, assetId);
    return Response.json({ asset, isReadable }, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("agent_plan_assets", error);
    return agentFailureResponse(error);
  }
}

/**
 * Takes a file for an asset node or stack entry:
 * `PUT /agent-api/plan-assets?projectId=<project>&name=<name>` with the file as the body.
 *
 * @remarks
 * The body is streamed to the store and counted while it arrives; the type is
 * detected from the content. The answer names the stored file, which the
 * editor writes into the node.
 */
export async function action({
  context,
  request,
}: Route.ActionArgs): Promise<Response> {
  if (request.method !== "PUT")
    throw new Response("Method Not Allowed", {
      headers: { Allow: "PUT" },
      status: 405,
    });
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const query = new URL(request.url).searchParams;
    const projectId = readPlanText(query.get("projectId"));
    const file = toUploadedFile(request, query.get("name") ?? "");
    const asset = await (
      await planAssets()
    ).upload(user.id, {
      projectId,
      fileName: file.fileName,
      contentLength: file.contentLength,
      body: file.body,
    });
    return Response.json({ asset }, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("agent_plan_assets", error);
    return agentFailureResponse(error);
  }
}
