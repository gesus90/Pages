import { authenticatedUserContext } from "@/app/lib/auth.server";
import { CHAT_NO_STORE, readChatJson } from "@/app/lib/chat-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import { logEvent } from "@/backend/logging/Logger";
import {
  PicaAdminError,
  isPicaAdminTool,
} from "@/backend/service/chat/admin/PicaAdminContracts";
import { registerPicaAdminTools } from "@/backend/service/chat/admin/PicaAdminTools";

import type { Route } from "./+types/pica-tools-api";

/** Dispatches only the native privileged registry, with same-origin protection and server-owned task identity. */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  try {
    if (
      !actor ||
      request.method !== "POST" ||
      request.headers.get("Origin") !== new URL(request.url).origin
    )
      throw new PicaAdminError("ADMIN_REQUIRED");
    const service = (await getApplicationServices()).picaAdminService;
    service.protectOrigin(new URL(request.url).origin);
    await service.requireAdministrator(actor.id);
    const input = await readChatJson(request);
    const taskId =
      typeof input.taskId === "string"
        ? input.taskId
        : await service.startConsole(actor.id);
    const execution = service.consoleContext(actor.id, taskId);
    if (input.tool === "task_close") {
      await service.release(execution);
      return Response.json(
        { ok: true, taskId: null },
        { headers: CHAT_NO_STORE },
      );
    }
    if (typeof input.tool !== "string" || !isPicaAdminTool(input.tool))
      throw new PicaAdminError("UNKNOWN_TOOL");
    const registry = new RuntimeToolRegistry();
    registerPicaAdminTools(registry, service, () => true);
    const invoked = await registry.invoke(
      input.tool,
      input.parameters,
      execution,
    );
    if (!invoked?.isValid) throw new PicaAdminError("INVALID_ARGUMENTS");
    return Response.json(
      { taskId, outcome: invoked.output },
      { headers: CHAT_NO_STORE },
    );
  } catch (error: unknown) {
    const code =
      error instanceof PicaAdminError ? error.message : "ADMIN_TOOL_FAILED";
    logEvent({
      level: "warn",
      event: "pica.admin.request.denied",
      component: "PicaAdminToolsRoute",
      message: "Privileged Pica request refused",
      metadata: { userId: actor?.id ?? null, code },
    });
    return Response.json(
      { ok: false, error: code },
      { status: code === "ADMIN_REQUIRED" ? 403 : 400, headers: CHAT_NO_STORE },
    );
  }
}
