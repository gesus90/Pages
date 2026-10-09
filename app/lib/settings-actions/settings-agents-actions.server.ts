import { readText, readTextOrEmpty } from "@/app/lib/form-fields.server";
import { AgentError } from "@/backend/error/AgentErrors";
import { isAgentFunction } from "@/definition/AgentAssignment";

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
  "create-assignment": (context) => saveAssignment(context, "create"),
  "update-assignment": (context) => saveAssignment(context, "update"),
  "delete-assignment": async ({ actor, services, formData }) => {
    await services.agentAssignmentService.remove(
      actor,
      readTextOrEmpty(formData, "function"),
    );
    return { ok: true };
  },
  "configure-retention": async ({ actor, services, formData }) => {
    await services.textAgentRoleService.saveRetention(
      actor,
      Number(readTextOrEmpty(formData, "retentionDays")),
    );
    return { ok: true };
  },
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
  "configure-text": async ({ actor, services, formData }) => {
    const connectionId = readTextOrEmpty(formData, "connectionId");
    await services.textAgentRoleService.save(actor, {
      retentionDays: Number(readTextOrEmpty(formData, "retentionDays")),
      role:
        connectionId === ""
          ? null
          : {
              connectionId,
              model: readTextOrEmpty(formData, "model"),
              reasoningEffort: readText(formData, "reasoningEffort"),
            },
    });
    return { ok: true };
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

async function saveAssignment(
  { actor, services, formData, id }: AgentActionContext,
  mode: "create" | "update",
): Promise<{ ok: true }> {
  const assignedFunction = readText(formData, "function");
  if (!isAgentFunction(assignedFunction))
    throw new AgentError("function_invalid");
  await services.agentAssignmentService.save(
    actor,
    {
      function: assignedFunction,
      connectionId: id,
      model: readTextOrEmpty(formData, "model"),
      reasoningEffort: readText(formData, "reasoningEffort"),
    },
    mode,
  );
  return { ok: true };
}

const CONNECTION_FREE_INTENTS = new Set([
  "create-connection",
  "configure-text",
  "configure-retention",
  "delete-assignment",
]);

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
  if (!CONNECTION_FREE_INTENTS.has(intent) && !id)
    throw new AgentError("connection_not_found");
  const result = await AGENT_ACTION_HANDLERS[intent]({ ...context, actor, id });
  return Response.json({ ...result, intent }, { headers: AGENT_NO_STORE });
}
