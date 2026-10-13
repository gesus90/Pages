import { agentApiFailure } from "@/app/lib/agent-api-response.server";
import { readAgentAssetUpload } from "@/app/lib/agent-asset-upload.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

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
    const { agentUploadTicketService, agentAssetService } =
      await getApplicationServices();
    const authority = await agentUploadTicketService.consume(ticket);
    const result = await agentAssetService.upload(
      readAgentAssetUpload(request, authority.fileName),
      authority.revalidate,
    );
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
    if (error instanceof AgentOperationError)
      return uploadFailure(error.code, error.status);
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
