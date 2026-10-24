import { z } from "zod";

import { getApplicationServices } from "@/app/lib/services.server";
import { RemoteError, remoteErrorStatus } from "@/backend/error/RemoteErrors";
import { consoleSizeSchema } from "@/definition/RemoteConsole";

import type { RemoteConsoleScope } from "@/backend/service/remote/RemoteConsoleService";
import type { User } from "@/definition/User";

/** One console request of the signed-in person for a workspace or a connection. */
export interface RemoteConsoleRequest {
  readonly request: Request;
  readonly user: User | null;
  readonly scope: RemoteConsoleScope;
}

// Input, geometry and output use the console channel; this route opens, retries and closes.
const commandSchema = z.discriminatedUnion("intent", [
  consoleSizeSchema.extend({ intent: z.literal("open") }),
  z.object({ intent: z.enum(["close", "reconnect"]), sessionId: z.uuid() }),
]);
const NO_STORE = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const MAXIMUM_BODY = 4096;

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

/** Reads a bounded body without exposing input in parser diagnostics or logs. */
async function readCommand(
  request: Request,
): Promise<z.infer<typeof commandSchema>> {
  const reader = request.body?.getReader();
  if (!reader) throw new RemoteError("remote_workspace_invalid");
  let body = "";
  const decoder = new TextDecoder();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    body += decoder.decode(chunk.value, { stream: true });
    if (body.length > MAXIMUM_BODY) {
      await reader.cancel();
      throw new RemoteError("remote_workspace_invalid");
    }
  }
  return commandSchema.parse(JSON.parse(body));
}

async function runCommand(
  input: RemoteConsoleRequest & { readonly userId: string },
  command: z.infer<typeof commandSchema>,
): Promise<Response> {
  const { userId, scope } = input;
  const consoles = (await getApplicationServices()).remoteConsoleService;
  if (command.intent === "open") {
    // The origin is the same-origin address the person reached Pages with.
    const origin = input.request.headers.get("Origin");
    const sessionId = await consoles.open(userId, scope, command, { origin });
    return Response.json({ sessionId }, { headers: NO_STORE });
  }
  if (command.intent === "close") {
    consoles.close(userId, scope, command.sessionId);
    return Response.json({ ok: true }, { headers: NO_STORE });
  }
  const session = await consoles.require(userId, scope, command.sessionId);
  session.reconnect();
  return Response.json({ ok: true }, { headers: NO_STORE });
}

/**
 * Opens and controls only the signed-in person's console, with current rights.
 *
 * @remarks
 * Requests must come from the same origin; every intent except closing
 * checks ownership and the current rights again, so a direct call with a
 * foreign session, workspace or connection is refused.
 *
 * @param input - The request, the signed-in person and the console scope.
 * @returns The JSON answer of the intent, or a classified error.
 */
export async function remoteConsoleAction(
  input: RemoteConsoleRequest,
): Promise<Response> {
  const { request, user } = input;
  try {
    if (!user || request.headers.get("Origin") !== new URL(request.url).origin)
      throw new RemoteError("remote_access_denied");
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    return await runCommand(
      { ...input, userId: user.id },
      await readCommand(request),
    );
  } catch (error: unknown) {
    return failureResponse(error);
  }
}
