import {
  mcpDeviceResponse,
  mcpDeviceFailure,
} from "@/app/lib/mcp-device-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  REPOSITORY_READ_SCHEMAS,
  RepositoryReadError,
} from "@/definition/RepositoryRead";

import type { RepositoryReadTool } from "@/definition/RepositoryRead";
import type { Route } from "./+types/api-mcp-v1-repository";

function readTool(operation: string | undefined): RepositoryReadTool | null {
  const name = `repository_${operation}`;
  return (
    Object.keys(REPOSITORY_READ_SCHEMAS).find(
      (tool): tool is RepositoryReadTool => tool === name,
    ) ?? null
  );
}

function failureStatus(error: RepositoryReadError): number {
  if (error.code === "FORBIDDEN") return 403;
  return error.code === "INVALID_REQUEST" ? 400 : 502;
}

/** Exposes GET-only repository reads to authenticated Pages agent/device sessions. */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const services = await getApplicationServices();
    const actor = await services.mcpUserApi.authenticate(
      request.headers.get("Authorization"),
    );
    const tool = readTool(params.operation);
    if (!tool) return mcpDeviceResponse({ error: "NOT_FOUND" }, 404);
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const input = {
      ...query,
      ...(query.page ? { page: Number(query.page) } : {}),
      ...(query.limit ? { limit: Number(query.limit) } : {}),
    };
    return mcpDeviceResponse(
      await services.repositoryReadService.run(actor.id, tool, input),
    );
  } catch (error: unknown) {
    if (error instanceof RepositoryReadError)
      return mcpDeviceResponse({ error: error.code }, failureStatus(error));
    return mcpDeviceFailure(error);
  }
}

/** Repository tools never offer writes, even for an administrator. */
export function action(): Response {
  return mcpDeviceResponse({ error: "METHOD_NOT_ALLOWED" }, 405, {
    Allow: "GET",
  });
}
