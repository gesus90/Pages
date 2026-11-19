import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { quotaCardOrderSchema } from "@/definition/AgentQuotaCardOrder";

import type { Route } from "./+types/agent-quota-order";

/**
 * Answers the order in which the signed-in person arranged the cards of the
 * Agents page.
 * @remarks
 * The order is empty until the person sorts their cards for the first time,
 * so the default order applies.
 */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const services = await getApplicationServices();
    const order = await services.quotaCardOrderService.read(user);
    return Response.json(order, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("agent_quota_order", error);
    return agentFailureResponse(error, "quota-order");
  }
}

async function readOrderBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/**
 * Stores the order in which the signed-in person arranged the cards and
 * replaces the earlier one.
 * @remarks
 * Only `PUT` stores. The page sends the whole order each time, so a request
 * that arrives late cannot leave a mix of two orders.
 */
export async function action({
  context,
  request,
}: Route.ActionArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    if (request.method !== "PUT")
      return new Response(null, { status: 405, headers: AGENT_NO_STORE });
    const order = quotaCardOrderSchema.safeParse(await readOrderBody(request));
    if (!order.success)
      return new Response(null, { status: 400, headers: AGENT_NO_STORE });
    const services = await getApplicationServices();
    await services.quotaCardOrderService.save(user, order.data);
    return new Response(null, { status: 204, headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("agent_quota_order", error);
    return agentFailureResponse(error, "quota-order");
  }
}
