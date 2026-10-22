import { z } from "zod";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { remoteConsoleStream } from "@/app/lib/remote-console-stream.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { RemoteError, remoteErrorStatus } from "@/backend/error/RemoteErrors";
import {
  CONSOLE_MAXIMUM_RETRIES,
  consoleSizeSchema,
} from "@/definition/RemoteConsole";

import type { Route } from "./+types/agent-workspace-console";

const commandSchema = z.discriminatedUnion("intent", [
  consoleSizeSchema.extend({ intent: z.literal("open") }),
  consoleSizeSchema.extend({
    intent: z.literal("resize"),
    sessionId: z.uuid(),
  }),
  z.object({
    intent: z.literal("input"),
    sessionId: z.uuid(),
    attempt: z.number().int().min(0).max(CONSOLE_MAXIMUM_RETRIES),
    input: z.string().max(8192),
  }),
  z.object({ intent: z.enum(["close", "reconnect"]), sessionId: z.uuid() }),
]);
const NO_STORE = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function failureResponse(error: unknown): Response {
  const message =
    error instanceof RemoteError
      ? `remote.error.${error.code}`
      : "remote.failure.remote_failed";
  return Response.json(
    { message },
    {
      status:
        error instanceof RemoteError ? remoteErrorStatus(error.code) : 400,
      headers: NO_STORE,
    },
  );
}

/** Opens and controls only the signed-in person's console, with current workspace rights. */
export async function action({
  request,
  context,
  params,
}: Route.ActionArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user || request.headers.get("Origin") !== new URL(request.url).origin)
      throw new RemoteError("remote_access_denied");
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    // Read a bounded body without exposing input in parser diagnostics or logs.
    const reader = request.body?.getReader();
    if (!reader) throw new RemoteError("remote_workspace_invalid");
    let body = "";
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += decoder.decode(chunk.value, { stream: true });
      if (body.length > 60_000) {
        await reader.cancel();
        throw new RemoteError("remote_workspace_invalid");
      }
    }
    const command = commandSchema.parse(JSON.parse(body));
    const consoles = (await getApplicationServices()).remoteConsoleService;
    const workspaceId = params.workspaceId;
    if (command.intent === "open") {
      const sessionId = await consoles.open(user.id, workspaceId, command);
      return Response.json({ sessionId }, { headers: NO_STORE });
    }
    if (command.intent === "close")
      consoles.close(user.id, workspaceId, command.sessionId);
    else {
      const session = await consoles.require(
        user.id,
        workspaceId,
        command.sessionId,
      );
      if (command.intent === "input")
        session.write(command.input, command.attempt);
      if (command.intent === "resize") session.resize(command);
      if (command.intent === "reconnect") session.reconnect();
    }
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error: unknown) {
    return failureResponse(error);
  }
}

/** Follows terminal events after verifying ownership, membership and project access. */
export async function loader({
  request,
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new RemoteError("remote_access_denied");
    const search = new URL(request.url).searchParams;
    const sessionId = z.uuid().parse(search.get("sessionId"));
    const after = z.coerce
      .number()
      .int()
      .min(0)
      .parse(request.headers.get("Last-Event-ID") ?? search.get("after") ?? 0);
    const consoles = (await getApplicationServices()).remoteConsoleService;
    const check = (): ReturnType<typeof consoles.require> =>
      consoles.require(user.id, params.workspaceId, sessionId);
    const session = await check();
    return new Response(
      remoteConsoleStream({ signal: request.signal, session, after, check }),
      {
        headers: {
          ...NO_STORE,
          "Content-Type": "text/event-stream; charset=utf-8",
          "X-Accel-Buffering": "no",
        },
      },
    );
  } catch (error: unknown) {
    return failureResponse(error);
  }
}
