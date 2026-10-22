import { AGENT_NO_STORE } from "./settings-agents-response.server";

import type { SettingsActionContext } from "./settings-action-support.server";

/** Forwards same-origin provider administration through the reconciled runner channel. */
export async function handleRunnerProviderRequest(
  { user, request, services, formData }: SettingsActionContext,
  connectionId: string,
): Promise<Response> {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json(
      { ok: false },
      { status: 403, headers: AGENT_NO_STORE },
    );
  if (formData.get("provider") !== "openrouter")
    return Response.json(
      { ok: false },
      { status: 400, headers: AGENT_NO_STORE },
    );
  const intent = formData.get("intent");
  const result = await services.runnerOpenRouterService.execute(
    user.id,
    connectionId,
    intent === "store-provider-key"
      ? { operation: "sync", apiKey: formData.get("apiKey") }
      : {
          operation: "check",
          model: formData.get("model") ?? "openrouter/free",
        },
  );
  return Response.json(
    { ok: result.ok, intent, result },
    { status: result.ok ? 200 : 409, headers: AGENT_NO_STORE },
  );
}
