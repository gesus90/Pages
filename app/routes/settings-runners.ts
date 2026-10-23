import { z } from "zod";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { AgentAccessDeniedError } from "@/backend/error/AgentErrors";
import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";
import { requireAgentAccount } from "@/app/lib/settings-actions/settings-agents-access.server";
import { AGENT_NO_STORE } from "@/app/lib/settings-actions/settings-agents-response.server";
import { handleRunnerProviderRequest } from "@/app/lib/settings-actions/settings-runner-provider.server";

import type { Route } from "./+types/settings-runners";

/** Serves the setup artifact only to an authenticated administrator in admin mode. */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
  const services = await getApplicationServices();
  await requireAgentAccount(services, context.get(authenticatedUserContext));
  return new Response(services.runnerSetupService.script(), {
    headers: {
      ...AGENT_NO_STORE,
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Content-Disposition": 'attachment; filename="pages_setup.sh"',
    },
  });
}

/** Authenticated administration; setup explicitly transfers only, without starting a process. */
export async function action(args: Route.ActionArgs): Promise<Response> {
  const context = await readSettingsRequest(args);
  const { user, services, formData } = context;
  const intent = formData.get("intent");
  try {
    await requireAgentAccount(services, user);
    if (intent === "runner-repository-access") {
      const workspaceId = z.string().uuid().parse(formData.get("workspaceId"));
      const result = await services.runnerDeployKeyService.checkRunnerAccess(
        user.id,
        workspaceId,
      );
      return Response.json(
        { ok: true, intent, result },
        { headers: AGENT_NO_STORE },
      );
    }
    if (intent === "deploy-key" || intent === "repository-access") {
      const projectId = z.string().uuid().parse(formData.get("projectId"));
      const result =
        intent === "deploy-key"
          ? await services.runnerDeployKeyService.register(user.id, {
              projectId,
              key: formData.get("publicKey"),
              title: formData.get("title"),
            })
          : await services.runnerDeployKeyService.checkAccess(
              user.id,
              projectId,
            );
      return Response.json(
        { ok: true, intent, result },
        { headers: AGENT_NO_STORE },
      );
    }
    const connectionId = z.string().uuid().parse(formData.get("connectionId"));
    if (
      intent === "store-provider-key" ||
      intent === "check-provider" ||
      intent === "sync-provider"
    ) {
      return await handleRunnerProviderRequest(context, connectionId);
    }
    if (intent === "revoke") {
      await services.runnerService.revoke(user.id, connectionId);
      return Response.json({ ok: true, intent }, { headers: AGENT_NO_STORE });
    }
    if (intent === "refresh-tools") {
      await services.runnerService.refreshTools(user.id, connectionId);
      return Response.json({ ok: true, intent }, { headers: AGENT_NO_STORE });
    }
    if (intent === "connect") {
      await services.runnerSetupService.connect(user.id, connectionId);
      return Response.json({ ok: true, intent }, { headers: AGENT_NO_STORE });
    }
    if (intent === "transfer") {
      const transfer = await services.runnerSetupService.transfer(
        user.id,
        connectionId,
      );
      return Response.json(
        { ok: true, intent, ...transfer },
        { headers: AGENT_NO_STORE },
      );
    }
    if (intent === "authorize") {
      const grant = await services.runnerService.authorize(
        user.id,
        connectionId,
      );
      return Response.json(
        { ok: true, intent, ...grant },
        { headers: AGENT_NO_STORE },
      );
    }
    return Response.json(
      { ok: false },
      { status: 400, headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    return Response.json(
      { ok: false },
      {
        status: error instanceof AgentAccessDeniedError ? 403 : 409,
        headers: AGENT_NO_STORE,
      },
    );
  }
}
