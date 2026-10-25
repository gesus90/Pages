import { agentApiFailure } from "@/app/lib/agent-api-response.server";
import { readAgentAssetUpload } from "@/app/lib/agent-asset-upload.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { PagesAgentApiErrorCode } from "@/definition/PagesAgentApi";
import type { Route } from "./+types/api-v1-agent-assets";

function uploadFailure(code: PagesAgentApiErrorCode, status: number): Response {
  const response = agentApiFailure(code, status);
  if (status === 401)
    response.headers.set("WWW-Authenticate", "Pages-Upload-Ticket");
  return response;
}

async function upload(request: Request): Promise<Response> {
  if (request.method !== "POST")
    return uploadFailure("METHOD_NOT_ALLOWED", 405);
  if (new URL(request.url).search !== "")
    return uploadFailure("INVALID_REQUEST", 400);
  const ticket = request.headers.get("X-Pages-Upload-Ticket") ?? "";
  if (
    request.headers.has("Authorization") ||
    !/^[A-Za-z0-9_-]{43}$/.test(ticket)
  )
    return uploadFailure("AUTH_REQUIRED", 401);
  try {
    const {
      agentUploadTicketService,
      agentAssetService,
      agentTicketUploadService,
    } = await getApplicationServices();
    const authority = await agentUploadTicketService.consume(ticket);
    const file = readAgentAssetUpload(request, authority.fileName);
    const result = authority.ticketId
      ? await agentTicketUploadService.upload(
          file,
          authority.revalidate,
          authority.ticketId,
        )
      : await agentAssetService.upload(file, authority.revalidate);
    return Response.json(
      { apiVersion: "1", result },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error: unknown) {
    logCaughtError("api_v1_agent_assets", error);

    if (error instanceof AgentOperationError)
      return agentApiFailure(error.code, error.status, error.details);
    if (error instanceof McpAuthorizationError)
      return uploadFailure("AUTH_INVALID", 401);
    return uploadFailure("AUTH_UNAVAILABLE", 503);
  }
}

/** Receives raw bytes under a one-use upload capability bound to a personal credential. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return upload(request);
}

/** Rejects non-upload methods without consulting identity or reading bytes. */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return upload(request);
}
