import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  data as routeData,
  Link,
  useLoaderData,
  useRevalidator,
} from "react-router";

import { AgentToolCard } from "@/app/components/settings/agents/tools/agent-tool-card";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { requireAgentAccount } from "@/app/lib/settings-actions/settings-agents-access.server";
import {
  AGENT_NO_STORE,
  agentFailureResponse,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import {
  AgentAccessDeniedError,
  AgentError,
} from "@/backend/error/AgentErrors";
import { AgentToolReadinessError } from "@/backend/service/agents/tools/AgentToolReadinessError";
import { isAgentToolAction, isAgentToolId } from "@/definition/AgentTools";

import type { AgentToolView } from "@/definition/AgentTools";
import type { Route } from "./+types/settings-agent-tools";

/** Every status read also enforces fresh persisted system administrator rights. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<
  ReturnType<typeof routeData<{ readonly tools: readonly AgentToolView[] }>>
> {
  try {
    const services = await getApplicationServices();
    const actor = await requireAgentAccount(
      services,
      context.get(authenticatedUserContext),
    );
    return routeData(
      { tools: services.agentToolManagerService.list(actor) },
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    throw agentFailureResponse(error);
  }
}

/** Accepts fixed IDs/actions only; direct requests have the same authorization as the page. */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<Response> {
  try {
    if (request.method !== "POST")
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { ...AGENT_NO_STORE, Allow: "POST" },
      });
    if (request.headers.get("Origin") !== new URL(request.url).origin)
      throw new AgentAccessDeniedError();
    const services = await getApplicationServices();
    const actor = await requireAgentAccount(
      services,
      context.get(authenticatedUserContext),
    );
    const form = await request.formData();
    const id = form.get("tool");
    const intent = form.get("intent");
    if (!isAgentToolId(id)) throw new AgentError("configuration_invalid");
    if (intent === "enable" || intent === "disable")
      await services.agentToolManagerService.setEnabled(
        actor,
        id,
        intent === "enable",
      );
    else if (isAgentToolAction(intent))
      await services.agentToolManagerService.manage(actor, id, intent);
    else throw new AgentError("configuration_invalid");
    return Response.json({ ok: true }, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    if (error instanceof AgentToolReadinessError)
      return Response.json(
        { ok: false, diagnostic: error.diagnostic, tool: error.tool },
        { status: 409, headers: AGENT_NO_STORE },
      );
    return agentFailureResponse(error);
  }
}

/** Keeps status and mutation responses out of browser/proxy caches. */
export const headers: Route.HeadersFunction = ({ parentHeaders }) => {
  const responseHeaders = new Headers(parentHeaders);
  responseHeaders.set("Cache-Control", "no-store");
  return responseHeaders;
};

/** Renders the system-admin tool inventory with cached status polling and bounded actions. */
export default function SettingsAgentToolsRoute(): React.ReactElement {
  const { tools } = useLoaderData<typeof loader>();
  const { t } = useTranslation();
  const { revalidate } = useRevalidator();
  useEffect(() => {
    const timer = setInterval(() => {
      void revalidate();
    }, 5000);
    return () => clearInterval(timer);
  }, [revalidate]);
  return (
    <div className="space-y-4">
      <Link
        className="text-sm text-primary-text hover:underline"
        to="/settings/agents"
      >
        {t("agentTools.back")}
      </Link>
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{t("agentTools.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("agentTools.description")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("agentTools.hostHint")}
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {tools.map((tool) => (
          <AgentToolCard key={tool.id} tool={tool} />
        ))}
      </div>
    </div>
  );
}
