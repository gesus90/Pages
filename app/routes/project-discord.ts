import {
  handleDiscordAction,
  statusOfDiscordResult,
  toDiscordFailure,
} from "@/app/lib/discord-actions.server";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { DiscordActionResult } from "@/definition/Discord";
import type { Route } from "./+types/project-discord";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
};

function respond(result: DiscordActionResult): Response {
  return Response.json(result, {
    headers: NO_STORE_HEADERS,
    status: statusOfDiscordResult(result),
  });
}

/** Loads the Discord panel of a project: connection, own attempt and channel choices. */
export async function loader({
  context,
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    return respond({ error: "forbidden", ok: false });
  }

  try {
    const services = await getApplicationServices();
    const state = await services.discordConnectionService.getState(
      actor,
      params.projectId,
      {
        includeChannels:
          new URL(request.url).searchParams.get("channels") === "1",
      },
    );

    return respond({ ok: true, state, test: null });
  } catch (error: unknown) {
    return respond(toDiscordFailure(error).result);
  }
}

/** Applies one Discord panel action: start, confirm, channel, events, test, disconnect or cancel. */
export async function action({
  context,
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    return respond({ error: "forbidden", ok: false });
  }

  try {
    return respond(
      await handleDiscordAction({
        actor,
        formData: await request.formData(),
        projectId: params.projectId,
        requestOrigin: new URL(request.url).origin,
        services: await getApplicationServices(),
      }),
    );
  } catch (error: unknown) {
    return respond(toDiscordFailure(error).result);
  }
}
