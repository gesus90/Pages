import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { AGENT_NO_STORE } from "@/app/lib/settings-actions/settings-agents-response.server";
import { forbidden } from "@/app/lib/settings-actions/settings-action-support.server";
import { resolveSystemSettingsAccess } from "@/app/lib/settings-actions/settings-system-access.server";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { InterpreterSettingsError } from "@/backend/service/interpreters/InterpreterProfiles";
import { interpreterProfileSchema } from "@/definition/InterpreterProfile";
import { logCaughtError } from "@/backend/logging/Logger";

import type { InterpreterProfiles } from "@/backend/service/interpreters/InterpreterProfiles";
import type { Route } from "./+types/settings-interpreters";

async function authorizedProfiles(
  context: Route.LoaderArgs["context"],
): Promise<InterpreterProfiles> {
  const user = context.get(authenticatedUserContext);
  const services = await getApplicationServices();
  if (
    !user ||
    (await resolveSystemSettingsAccess(services, user)) !== "granted"
  )
    throw forbidden();
  return (await getPagesRuntime()).interpreterProfiles;
}

/** Exposes current volatile observations only in active admin mode. */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
  const profiles = await authorizedProfiles(context);
  return Response.json(await profiles.snapshot(), { headers: AGENT_NO_STORE });
}

/** Checks one explicit program or saves a validated, conflict-checked profile list. */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<Response> {
  const profiles = await authorizedProfiles(context);
  if (request.method !== "POST")
    throw new Response("Method Not Allowed", { status: 405 });
  try {
    const form = await request.formData();
    if (form.get("intent") === "check") {
      const parsed = interpreterProfileSchema.safeParse({
        id: form.get("id"),
        name: form.get("name"),
        path: form.get("path"),
      });
      if (!parsed.success) throw new InterpreterSettingsError("invalid");
      return Response.json(
        { check: await profiles.check(parsed.data.path) },
        { headers: AGENT_NO_STORE },
      );
    }
    const serialized = form.get("profiles");
    const revision = form.get("revision");
    if (
      form.get("intent") !== "save" ||
      typeof serialized !== "string" ||
      serialized.length > 160_000 ||
      typeof revision !== "string"
    )
      throw new InterpreterSettingsError("invalid");
    const snapshot = await profiles.save(JSON.parse(serialized), revision);
    return Response.json({ snapshot }, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    if (error instanceof InterpreterSettingsError)
      return Response.json(
        { error: error.code, checks: error.checks },
        { status: 400, headers: AGENT_NO_STORE },
      );
    if (error instanceof SyntaxError)
      return Response.json(
        { error: "invalid" },
        { status: 400, headers: AGENT_NO_STORE },
      );
    logCaughtError("InterpreterSettings", error);
    return Response.json(
      { error: "general" },
      { status: 500, headers: AGENT_NO_STORE },
    );
  }
}
