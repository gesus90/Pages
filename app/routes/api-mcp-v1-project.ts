import { getApplicationServices } from "@/app/lib/services.server";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import {
  mcpProjectResponse,
  readMcpProjectBody,
  requireMcpProjectParameter,
  runMcpProjectRoute,
} from "@/app/lib/mcp-project-route.server";
import { McpProjectRequest } from "@/backend/service/mcp/project/McpProjectRequest";

import type { McpProjectHandlers } from "@/app/lib/mcp-project-route.server";
import type { Route } from "./+types/api-mcp-v1-project";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpProjectHandlers {
  return {
    GET: async ({ api, context }) => {
      const projectId = requireMcpProjectParameter(params.projectId);
      const services = await getApplicationServices();
      const project = await api.reads.read(context, projectId);
      const account = await services.administrationService.getContext(
        context.actor.id,
      );
      const revision = new UserPolicyService("mcp").hasGlobalAccess(account)
        ? await services.managementService.projectRevision(
            context.actor.id,
            projectId,
          )
        : undefined;
      return mcpProjectResponse({ project: { ...project, revision } });
    },
    PATCH: async ({ api, context, request }) => {
      const body = McpProjectRequest.patch(await readMcpProjectBody(request));
      return mcpProjectResponse({
        project: await api.writes.patch(
          context,
          requireMcpProjectParameter(params.projectId),
          body,
        ),
      });
    },
  };
}

/**
 * Reads a project (`GET /api/mcp/v1/projects/{id}`) and changes it (`PATCH`), PAGE-244 interface 2 and 4.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpProjectRoute(request, handlers(params));
}

/** Serves the changing methods of the same resource. */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpProjectRoute(request, handlers(params));
}
