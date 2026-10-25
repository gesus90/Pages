import { readText, readTextOrEmpty } from "@/app/lib/form-fields.server";
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
    zaiAccountType: readText(formData, "zaiAccountType") ?? undefined,
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

function retiredProfileAction(): Promise<never> {
  return Promise.reject(new AgentError("profile_management_retired"));
}

const AGENT_ACTION_HANDLERS: Readonly<Record<string, AgentActionHandler>> = {
  "set-connection-active": async ({ actor, services, formData, id }) => {
    await services.agentConnectionService.setActive(
      actor,
      id,
      readActive(formData),
    );
    await services.openCodeProviderLinks.afterKeyChange(actor, id);
    await services.openCodeProviderLinks.activate(actor, id);
    return { ok: true, connectionId: id };
  },
  "save-pica": async ({ actor, services, formData }) => {
    const enabled = readText(formData, "isEnabled");
    const connectionId = readTextOrEmpty(formData, "modelConnectionId");
    const model = readTextOrEmpty(formData, "model");
    const effort = readTextOrEmpty(formData, "reasoningEffort");
    const revision = Number(readText(formData, "revision"));
    if (
      (enabled !== "true" && enabled !== "false") ||
      connectionId.length > 100 ||
      model.length > 500 ||
      effort.length > 100 ||
      !Number.isSafeInteger(revision)
    )
      throw new AgentError("profile_invalid");
    await services.picaSettingsService.save(actor.userId, {
      isEnabled: enabled === "true",
      selection:
        connectionId && model
          ? { connectionId, model, reasoningEffort: effort || null }
          : null,
      revision,
    });
    return { ok: true };
  },
  "save-profile": retiredProfileAction,
  "delete-profile": retiredProfileAction,
  "profile-usages": retiredProfileAction,
  "delete-assignment": retiredProfileAction,
  "create-connection": async ({ actor, services, formData }) => {
    const connectionId = await services.agentConnectionService.create(
      actor,
      readConnectionInput(formData),
    );
    // A stored key reaches OpenCode, and a new OpenCode connection signs in, without a further step.
    await services.openCodeProviderLinks.afterKeyChange(actor, connectionId);
    await services.openCodeProviderLinks.activate(actor, connectionId);
    return { ok: true, connectionId };
  },
  "update-connection": async ({ actor, services, formData, id }) => {
    const input = readConnectionInput(formData);
    await services.agentConnectionService.update(actor, id, input);
    if (input.apiKey || input.zaiAccountType)
      await services.openCodeProviderLinks.afterKeyChange(actor, id);
    return { ok: true, connectionId: id };
  },
  "delete-connection": async ({ actor, services, id }) => {
    const isLinked = await services.openCodeProviderLinks.isLinkCandidate(id);
    await services.agentConnectionService.remove(actor, id);
    if (isLinked) await services.openCodeProviderLinks.refresh();
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
    const check = await services.agentCheckService.run(actor, id, kind);
    if (
      kind === "auth" &&
      (await services.openCodeProviderLinks.isLinkCandidate(id))
    )
      await services.openCodeProviderLinks.refresh();
    return { ok: true, check };
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
    // Without its own key an OpenCode connection keeps the free and the linked providers.
    await services.openCodeProviderLinks.activate(actor, id);
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
  "save-pica",
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
