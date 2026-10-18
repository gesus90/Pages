import {
  readOptionalText,
  readText,
  readTextOrEmpty,
} from "@/app/lib/form-fields.server";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

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

/** An absent field leaves the scope unchanged; malformed content is a stable error. */
function readScopeField(formData: FormData): unknown {
  const content = readTextOrEmpty(formData, "scope");
  if (content === "") return undefined;
  if (content.length > 50_000) throw new AgentError("connection_scope_invalid");
  try {
    return JSON.parse(content);
  } catch (caughtError: unknown) {
    logCaughtError("settings_agents_actions", caughtError);

    // The parser's own message would echo request content.
    throw new AgentError("connection_scope_invalid");
  }
}

function readConnectionInput(formData: FormData): AgentConnectionInput {
  return {
    name: readTextOrEmpty(formData, "name"),
    provider: readText(formData, "provider") ?? undefined,
    apiKey: readTextOrEmpty(formData, "apiKey"),
    testModel: readTextOrEmpty(formData, "testModel"),
    reasoningEffort: readTextOrEmpty(formData, "reasoningEffort"),
    scope: readScopeField(formData),
  };
}

function readActive(formData: FormData): boolean {
  const active = readText(formData, "isActive");
  if (active !== "true" && active !== "false")
    throw new AgentError("profile_invalid");
  return active === "true";
}

const AGENT_ACTION_HANDLERS: Readonly<Record<string, AgentActionHandler>> = {
  "set-connection-active": async ({ actor, services, formData, id }) => {
    await services.agentConnectionService.setActive(
      actor,
      id,
      readActive(formData),
    );
    return { ok: true, connectionId: id };
  },
  "save-profile": async ({ actor, services, formData }) => {
    const content = readTextOrEmpty(formData, "profile");
    if (content.length > 500000) throw new AgentError("profile_invalid");
    const profile: unknown = JSON.parse(content);
    // The editor of a new agent sends an empty ID; only a filled one names an existing agent.
    await services.agentProfileService.save(
      actor,
      readOptionalText(formData, "profileId"),
      profile,
    );
    return { ok: true };
  },
  "delete-profile": async ({ actor, services, formData }) => {
    await services.agentProfileService.remove(
      actor,
      readTextOrEmpty(formData, "profileId"),
    );
    return { ok: true };
  },
  "profile-usages": async ({ actor, services, formData }) => ({
    ok: true,
    usages: await services.agentProfileService.usages(
      actor,
      readTextOrEmpty(formData, "profileId"),
    ),
  }),
  "delete-assignment": async ({ actor, services, formData }) => {
    await services.agentAssignmentService.remove(
      actor,
      readTextOrEmpty(formData, "function"),
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
  "store-cli-key": async ({ actor, services, formData, id }) => {
    await services.agentCliLoginService.storeKey(actor, id, {
      apiKey: readTextOrEmpty(formData, "apiKey"),
      modelProvider: readTextOrEmpty(formData, "modelProvider"),
    });
    return { ok: true, connectionId: id };
  },
};

const CONNECTION_FREE_INTENTS = new Set([
  "save-profile",
  "delete-profile",
  "profile-usages",
  "create-connection",
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
