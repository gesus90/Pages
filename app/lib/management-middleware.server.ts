import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { McpDeviceError } from "@/backend/error/McpDeviceError";

import { getSessionToken } from "./session.server";
import { isSetupPending } from "./setup-gate.server";
import { getAuthenticatedUser } from "./auth.server";
import { getApplicationServices } from "./services.server";

import type { MiddlewareFunction } from "react-router";

const CORE_PATH =
  /^(?:\/settings\/(?:system|agents|agent-tools)(?:\/|$)|\/settings-api\/(?:system|agents|agent-tools|runners|interpreters|embed-domains|ticket-assets)(?:\/|$)|\/agents\/workspaces\/remote(?:\/|$)|\/api\/mcp\/v1\/(?:remote-connections|remote-workspaces|storage)(?:\/|$)|\/storage(?:-api|\/|$)|\/setup(?:\/|$))/u;

/** Audits the verified management account across UI and paired HTTP clients and hides core-system endpoints. */
export const managementRequestMiddleware: MiddlewareFunction = async (
  { request },
  next,
) => {
  const path = new URL(request.url).pathname;
  if (await isSetupPending()) return next();
  const isPaired =
    path.startsWith("/api/mcp/v1/") && request.headers.has("authorization");
  if (!isPaired && !(await getSessionToken(request))) return next();
  const services = await getApplicationServices();
  let userId: string | undefined;
  if (path.startsWith("/api/mcp/v1/") && request.headers.has("authorization")) {
    try {
      const identity = await services.mcpDeviceService.authenticate(
        request.headers.get("authorization"),
      );
      userId = (
        await services.userService.findCredentialsByUsername(
          identity.account.username,
        )
      )?.user.id;
    } catch (error: unknown) {
      if (!(error instanceof McpDeviceError)) throw error;
    }
  } else userId = (await getAuthenticatedUser(request))?.id;
  if (!userId) return next();
  const account = await services.administrationService.getContext(userId);
  const policy = new UserPolicyService(
    path.startsWith("/api/mcp/") ? "mcp" : "ui",
  );
  if (!policy.isManagement(account) || policy.isAdministrator(account))
    return next();
  return services.managementService.audit.run(
    userId,
    request.method,
    path,
    async () => {
      if (CORE_PATH.test(path))
        return Response.json(
          { error: "FORBIDDEN", reason: "core_system" },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        );
      try {
        return await next();
      } catch (error: unknown) {
        if (error instanceof AgentOperationError)
          return Response.json(
            { error: error.code, ...error.details },
            { status: error.status, headers: { "Cache-Control": "no-store" } },
          );
        throw error;
      }
    },
  );
};
