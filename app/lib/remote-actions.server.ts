import { RemoteError, remoteErrorStatus } from "@/backend/error/RemoteErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { effectiveRemoteRoots } from "@/definition/RemoteConnection";

import { AGENT_NO_STORE } from "./settings-actions/settings-agents-response.server";

import type { ApplicationServices } from "./services.server";
import type {
  RemoteActionResult,
  RemoteOverview,
  RemoteTestResult,
} from "@/definition/RemoteConnection";

/** What every remote intent receives. */
interface RemoteIntentContext {
  readonly services: ApplicationServices;
  readonly userId: string;
  readonly formData: FormData;
}

type RemoteIntentHandler = (
  context: RemoteIntentContext,
) => Promise<{ readonly test?: RemoteTestResult }>;

const MAXIMUM_INPUT = 50_000;

function readIdentifier(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== "string" || value.length > 100)
    throw new RemoteError("remote_connection_invalid");
  return value;
}

function readRevision(formData: FormData): number {
  const revision = Number(formData.get("revision"));
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new RemoteError("remote_conflict");
  return revision;
}

/**
 * Parses the JSON input of a dialog.
 *
 * @remarks
 * A syntax error is replaced, not logged: the engine's message can quote
 * the input, which may hold a password or key.
 */
function readInput(formData: FormData, invalid: RemoteError): unknown {
  const content = formData.get("input");
  if (typeof content !== "string" || content.length > MAXIMUM_INPUT)
    throw invalid;
  try {
    return JSON.parse(content);
  } catch {
    throw invalid;
  }
}

function connectionInput(formData: FormData): unknown {
  return readInput(formData, new RemoteError("remote_connection_invalid"));
}

const HANDLERS: Readonly<Record<string, RemoteIntentHandler>> = {
  "test-connection": async ({ services, userId, formData }) => ({
    test: await services.remoteConnectionService.test(
      userId,
      readIdentifier(formData, "connectionId") || null,
      connectionInput(formData),
    ),
  }),
  "save-connection": async ({ services, userId, formData }) => {
    const id = readIdentifier(formData, "connectionId");
    const input = connectionInput(formData);
    if (id) await services.remoteConnectionService.update(userId, id, input);
    else await services.remoteConnectionService.create(userId, input);
    return {};
  },
  "delete-connection": async ({ services, userId, formData }) => {
    await services.remoteConnectionService.remove(
      userId,
      readIdentifier(formData, "connectionId"),
      readRevision(formData),
    );
    return {};
  },
  "check-connection": async ({ services, userId, formData }) => {
    await services.remoteConnectionService.testStored(
      userId,
      readIdentifier(formData, "connectionId"),
    );
    return {};
  },
  reconnect: async ({ services, userId, formData }) => {
    await services.remoteConnectionService.reconnect(
      userId,
      readIdentifier(formData, "connectionId"),
    );
    return {};
  },
  "save-remote-workspace": async ({ services, userId, formData }) => {
    await services.remoteWorkspaceService.save(
      userId,
      readIdentifier(formData, "workspaceId") || null,
      readInput(formData, new RemoteError("remote_workspace_invalid")),
    );
    return {};
  },
  "check-remote-workspace": async ({ services, userId, formData }) => {
    await services.remoteWorkspaceService.check(
      userId,
      readIdentifier(formData, "workspaceId"),
    );
    return {};
  },
  "delete-remote-workspace": async ({ services, userId, formData }) => {
    await services.remoteWorkspaceService.remove(
      userId,
      readIdentifier(formData, "workspaceId"),
      readRevision(formData),
    );
    return {};
  },
};

/** Keeps every response uncacheable and answers only with stable codes. */
function remoteFailureResponse(error: unknown, intent: string): Response {
  if (error instanceof Response) {
    const headers = new Headers(error.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(error.body, { status: error.status, headers });
  }
  const isRemote = error instanceof RemoteError;
  const result: RemoteActionResult = {
    ok: false,
    intent,
    error: isRemote ? error.code : "general",
    failure: isRemote ? error.failure : null,
  };
  return Response.json(result, {
    status: isRemote ? remoteErrorStatus(error.code) : 500,
    headers: AGENT_NO_STORE,
  });
}

/**
 * Runs one remote intent of the working-directory page.
 *
 * @param context - Services, the signed-in person and the submitted form.
 * @returns The JSON response; secrets of the form never appear in it or in a log.
 */
export async function runRemoteAction(
  context: RemoteIntentContext,
): Promise<Response> {
  const intent = String(context.formData.get("intent") ?? "");
  try {
    const handler = Object.hasOwn(HANDLERS, intent)
      ? HANDLERS[intent]
      : undefined;
    if (!handler) throw new RemoteError("remote_connection_invalid");
    const result: RemoteActionResult = {
      ok: true,
      intent,
      ...(await handler(context)),
    };
    return Response.json(result, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("agent_remote", error);
    return remoteFailureResponse(error, intent);
  }
}

/**
 * Loads the remote part of the working-directory page, filtered for the person.
 *
 * @param services - The application services.
 * @param userId - The signed-in person.
 * @returns Connections, departments for administrators, profiles, choices and installation states.
 */
export async function loadRemoteOverview(
  services: Pick<
    ApplicationServices,
    | "remoteConnectionService"
    | "remoteWorkspaceService"
    | "remoteInstallService"
  >,
  userId: string,
): Promise<RemoteOverview> {
  const [scope, workspaces] = await Promise.all([
    services.remoteConnectionService.scope(userId),
    services.remoteWorkspaceService.list(userId),
  ]);
  const installs = scope.canManage
    ? await services.remoteInstallService.views(scope.connections)
    : {};
  return {
    canManageConnections: scope.canManage,
    connections: scope.connections,
    departments: scope.departments,
    workspaces,
    choices: scope.connections.map((connection) => ({
      id: connection.id,
      name: connection.name,
      host: connection.host,
      hasHostKey: connection.hostKey !== null,
      allowedRoots: effectiveRemoteRoots(
        connection.allowedRoots,
        connection.username,
      ),
    })),
    installs,
  };
}
