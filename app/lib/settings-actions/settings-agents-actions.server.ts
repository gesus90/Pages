import { readText, readTextOrEmpty } from "@/app/lib/form-fields.server";
import { AgentError } from "@/backend/error/AgentErrors";

import { badRequest } from "./settings-action-support.server";
import { requireAgentAccount } from "./settings-agents-access.server";
import { AGENT_NO_STORE } from "./settings-agents-response.server";
import { handleSetMode } from "./settings-mode-action.server";

import type { AccountAccess } from "@/definition/Authorization";
import type { AgentConnectionInput } from "@/definition/AgentConnection";
import type { SettingsActionContext } from "./settings-action-support.server";
import type { AgentActionResult } from "./settings-agents-response.server";

interface AgentActionContext extends SettingsActionContext {
  readonly actor: AccountAccess;
  readonly id: string;
}

type AgentActionHandler = (
  context: AgentActionContext,
) => Promise<Omit<Extract<AgentActionResult, { ok: true }>, "intent">>;

function readConnectionInput(formData: FormData): AgentConnectionInput {
  return {
    name: readTextOrEmpty(formData, "name"),
    provider: readText(formData, "provider") ?? undefined,
    apiKey: readTextOrEmpty(formData, "apiKey"),
    testModel: readTextOrEmpty(formData, "testModel"),
    reasoningEffort: readTextOrEmpty(formData, "reasoningEffort"),
  };
}

const AGENT_ACTION_HANDLERS: Readonly<Record<string, AgentActionHandler>> = {
  "create-connection": async ({ actor, services, formData }) => ({
    ok: true,
    connectionId: await services.agentConnectionService.create(
      actor,
      readConnectionInput(formData),
    ),
  }),
  "update-connection": async ({ actor, services, formData, id }) => {
    await services.agentConnectionService.update(
      actor,
      id,
      readConnectionInput(formData),
    );
    return { ok: true, connectionId: id };
  },
  "delete-connection": async ({ actor, services, id }) => {
    await services.agentConnectionService.remove(actor, id);
    return { ok: true, connectionId: id };
  },
  "configure-catalog": async ({ actor, services, formData, id }) => {
    const interval = readText(formData, "intervalHours");
    await services.agentCatalogService.configure(
      actor,
      id,
      interval ? Number(interval) : NaN,
    );
    return { ok: true, connectionId: id };
  },
  "refresh-catalog": async ({ actor, services, id }) => {
    await services.agentCatalogService.run(actor, id);
    return { ok: true, connectionId: id };
  },
  "run-check": async ({ actor, services, formData, id }) => {
    const kind = formData.get("kind");
    if (kind !== "auth" && kind !== "model") throw badRequest();
    return {
      ok: true,
      check: await services.agentCheckService.run(actor, id, kind),
    };
  },
  "start-login": async ({ actor, services, id }) => ({
    ok: true,
    login: await services.agentCliLoginService.start(actor, id),
  }),
  "submit-login-code": async ({ actor, services, formData, id }) => {
    await services.agentCliLoginService.submitCode(
      actor,
      id,
      readTextOrEmpty(formData, "code"),
    );
    return { ok: true };
  },
  "cancel-login": async ({ actor, services, id }) => {
    await services.agentCliLoginService.cancel(actor, id);
    return { ok: true };
  },
  "logout-cli": async ({ actor, services, id }) => {
    await services.agentCliLoginService.logout(actor, id);
    return { ok: true };
  },
};

/** Dispatches only known intents after checking fresh account facts, preserving mode switching. */
export async function handleAgentsAction(
  context: SettingsActionContext,
): Promise<Response> {
  const intent = readText(context.formData, "intent");
  if (intent === "set-mode") {
    const result = await handleSetMode(context);
    return Response.json(result.data, {
      ...result.init,
      headers: AGENT_NO_STORE,
    });
  }
  const actor = await requireAgentAccount(context.services, context.user);
  if (!intent || !Object.hasOwn(AGENT_ACTION_HANDLERS, intent))
    throw badRequest();
  const id = readTextOrEmpty(context.formData, "connectionId");
  if (intent !== "create-connection" && !id)
    throw new AgentError("connection_not_found");
  const result = await AGENT_ACTION_HANDLERS[intent]({ ...context, actor, id });
  return Response.json({ ...result, intent }, { headers: AGENT_NO_STORE });
}
