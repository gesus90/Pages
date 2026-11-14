import {
  mcpConversationResponse,
  readMcpConversationBody,
  runMcpConversationRoute,
} from "@/app/lib/mcp-conversation-route.server";

import type { McpConversationHandlers } from "@/app/lib/mcp-conversation-route.server";
import type { Route } from "./+types/api-mcp-v1-conversation-reply-settings";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpConversationHandlers {
  return {
    GET: async ({ api, account }) =>
      mcpConversationResponse(await api.read(account, params.conversationId)),
    PUT: async ({ api, account, request }) =>
      mcpConversationResponse(
        await api.set(
          account,
          params.conversationId,
          await readMcpConversationBody(request),
        ),
      ),
  };
}

/**
 * Reads who answers in a group chat (`GET /api/mcp/v1/conversations/{conversationId}/reply-settings`), PAGE-317.
 *
 * @remarks
 * Only the device token of a paired machine admits a request. The account
 * reads the settings of a group it belongs to.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpConversationRoute(request, handlers(params));
}

/**
 * Sets who answers (`PUT`): `mode`, the thresholds `answerThreshold`,
 * `responsibilityThreshold` and `secondThreshold`, `maximumResponders` or
 * `useDefaults` (PAGE-379), with the rights of the chat page, so only the
 * account that manages the group changes them.
 */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpConversationRoute(request, handlers(params));
}
