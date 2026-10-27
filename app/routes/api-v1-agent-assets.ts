import { contentDisposition } from "@/app/lib/content-disposition";
import { agentApiFailure } from "@/app/lib/agent-api-response.server";
import { readAgentAssetUpload } from "@/app/lib/agent-asset-upload.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentAsset } from "@/definition/PagesAgentWrites";
import type { AgentAssetService } from "@/backend/service/agents/AgentAssetService";
import type { AgentTicketUploadService } from "@/backend/service/agents/AgentTicketUploadService";
import type { AgentUploadTicketService } from "@/backend/service/agents/AgentUploadTicketService";
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
    const result = await receiveUpload({
      file,
      authority,
      agentTicketUploadService,
      agentAssetService,
    });
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

/** Downloads only a one-use authorized original, with no active-document execution. */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  if (request.method !== "GET") return uploadFailure("METHOD_NOT_ALLOWED", 405);
  if (new URL(request.url).search || request.headers.has("Authorization"))
    return uploadFailure("INVALID_REQUEST", 400);
  const ticket = request.headers.get("X-Pages-Download-Ticket") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket))
    return uploadFailure("AUTH_REQUIRED", 401);
  try {
    const { agentAssetDownloadService } = await getApplicationServices();
    const file = await agentAssetDownloadService.consume(ticket);
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.original.mimeType,
        "Content-Length": String(file.size),
        "Content-Disposition": contentDisposition("attachment", file.fileName),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "X-Pages-Asset-Digest": file.original.digest,
      },
    });
  } catch (error: unknown) {
    if (error instanceof AgentOperationError)
      return agentApiFailure(error.code, error.status, error.details);
    if (error instanceof McpAuthorizationError)
      return uploadFailure("AUTH_INVALID", 401);
    return uploadFailure("AUTH_UNAVAILABLE", 503);
  }
}

async function receiveUpload(input: {
  readonly file: ReturnType<typeof readAgentAssetUpload>;
  readonly authority: Awaited<ReturnType<AgentUploadTicketService["consume"]>>;
  readonly agentTicketUploadService: AgentTicketUploadService;
  readonly agentAssetService: AgentAssetService;
}): Promise<AgentAsset> {
  const { file, authority, agentTicketUploadService, agentAssetService } =
    input;
  if (authority.pageId && authority.request)
    return agentTicketUploadService.uploadWiki(
      file,
      authority.revalidate,
      authority.pageId,
      authority.request,
    );
  if (authority.ticketId)
    return agentTicketUploadService.upload(
      file,
      authority.revalidate,
      authority.ticketId,
      authority.request,
    );
  return agentAssetService.upload(file, authority.revalidate);
}
