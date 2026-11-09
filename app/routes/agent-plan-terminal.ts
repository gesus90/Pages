import { authenticatedUserContext } from "@/app/lib/auth.server";
import {
  readSessionCursor,
  readSessionKey,
} from "@/app/lib/agent-session-request.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { TERMINAL_PASTE_CHARACTERS } from "@/definition/AgentTerminal";

import type { AgentTerminalCommand } from "@/definition/AgentTerminal";
import type { Route } from "./+types/agent-plan-terminal";

/**
 * Opens the terminal of a node attempt, or reads one page of older segments
 * with `before`.
 *
 * @remarks
 * Reading uses the stored segments only; it starts no process.
 */
export async function loader({
  request,
  params,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const search = new URL(request.url).searchParams;
    const key = readSessionKey(params, search);
    const terminals = (await getApplicationServices()).agentTerminalService;
    if (search.has("before")) {
      const page = await terminals.older(
        user.id,
        key,
        readSessionCursor(search.get("before")),
      );
      return Response.json({ ok: true, page }, { headers: AGENT_NO_STORE });
    }
    const opening = await terminals.open(user.id, key);
    return Response.json({ ok: true, opening }, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("agent_plan_terminal", error);

    return agentFailureResponse(error, "terminal-read");
  }
}

function readCommand(formData: FormData): AgentTerminalCommand {
  const intent = formData.get("intent");
  if (intent === "interrupt") return { type: "interrupt" };
  const text = formData.get("text");
  if (
    intent !== "paste" ||
    typeof text !== "string" ||
    text.trim().length === 0 ||
    text.length > TERMINAL_PASTE_CHARACTERS
  )
    throw new AgentError("plan_invalid");
  return { type: "paste", text };
}

/**
 * Sends the multi-line input as one paste or interrupts the current step;
 * the right to run the plan is checked for this request on the server.
 */
export async function action(args: Route.ActionArgs): Promise<Response> {
  try {
    const { user, services, formData, request } =
      await readSettingsRequest(args);
    const key = readSessionKey(args.params, new URL(request.url).searchParams);
    await services.agentTerminalService.send(
      user.id,
      key,
      readCommand(formData),
    );
    return Response.json({ ok: true }, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("agent_plan_terminal", error);

    return agentFailureResponse(error, "terminal-input");
  }
}
