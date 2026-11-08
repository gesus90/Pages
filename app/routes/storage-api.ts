import { authenticatedUserContext } from "@/app/lib/auth.server";
import { GOOGLE_DRIVE_NO_STORE_HEADERS } from "@/app/lib/google-drive-route.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { isSystemSettingsGranted } from "@/app/lib/settings-actions/settings-system-access.server";
import { logCaughtError } from "@/backend/logging/Logger";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { StorageStartFolderSaveResult } from "@/definition/GoogleDriveStorage";
import type { User } from "@/definition/User";
import type { Route } from "./+types/storage-api";

/** Google's page cursors are short; anything longer is no cursor of Drive. */
const MAXIMUM_PAGE_TOKEN_LENGTH = 2048;

function respond(body: unknown, status = 200): Response {
  return Response.json(body, {
    headers: GOOGLE_DRIVE_NO_STORE_HEADERS,
    status,
  });
}

/**
 * Returns the services when the account may use Storage, else `null`.
 *
 * @remarks
 * The Drive connection is the one Google account an administrator signed in
 * for the instance. Storage therefore follows the right of the system
 * settings: an administrator in the active admin mode. Opening it to other
 * accounts would share that Google account without anyone deciding so.
 */
async function grantedServices(
  user: User | null,
): Promise<ApplicationServices | null> {
  if (!user) {
    return null;
  }

  const services = await getApplicationServices();

  return (await isSystemSettingsGranted(services, user)) ? services : null;
}

function readOptional(
  parameters: URLSearchParams,
  name: string,
): string | null {
  const entry = parameters.get(name)?.trim() ?? "";

  return entry === "" ? null : entry;
}

function readPageToken(parameters: URLSearchParams): string | null {
  const pageToken = readOptional(parameters, "pageToken");

  return pageToken !== null && pageToken.length <= MAXIMUM_PAGE_TOKEN_LENGTH
    ? pageToken
    : null;
}

/**
 * Shows a Drive folder or the storage quota of the connected account.
 *
 * @remarks
 * `?view=quota` reads `about.get`; otherwise `folder` names an explicit
 * target, and without it the saved start folder or My Drive opens.
 * `foldersOnly=1` lists only folders, for the start folder choice. Every call
 * checks the Pages right and takes a freshly confirmed Drive access.
 */
export async function loader({
  context,
  request,
}: Route.LoaderArgs): Promise<Response> {
  const user = context.get(authenticatedUserContext);
  const services = await grantedServices(user);

  if (!user || !services) {
    return respond({ error: "forbidden" }, 403);
  }

  const parameters = new URL(request.url).searchParams;
  const storage = services.googleDriveStorageService;

  try {
    if (parameters.get("view") === "quota") {
      return respond(await storage.readQuota());
    }

    return respond(
      await storage.browse({
        folderId: readOptional(parameters, "folder"),
        isFoldersOnly: parameters.get("foldersOnly") === "1",
        pageToken: readPageToken(parameters),
        userId: user.id,
      }),
    );
  } catch (error: unknown) {
    logCaughtError("storage_api", error);

    return respond({ error: "failed" }, 500);
  }
}

/**
 * Saves or clears the start folder of the signed-in account.
 *
 * @remarks
 * `intent=save-start` with `folderId` saves a folder Drive confirms just now;
 * `intent=clear-start` removes the start folder.
 */
export async function action({
  context,
  request,
}: Route.ActionArgs): Promise<Response> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const user = context.get(authenticatedUserContext);
  const services = await grantedServices(user);

  if (!user || !services) {
    return respond({ error: "forbidden" }, 403);
  }

  const formData = await request.formData();
  const intent = formData.get("intent");
  const folderId = formData.get("folderId");
  const storage = services.googleDriveStorageService;

  try {
    if (intent === "clear-start") {
      return respond(await storage.clearStartFolder(user.id));
    }

    if (intent === "save-start" && typeof folderId === "string") {
      return respond(await storage.saveStartFolder(user.id, folderId));
    }

    return respond(
      { error: "invalid", ok: false } satisfies StorageStartFolderSaveResult,
      400,
    );
  } catch (error: unknown) {
    logCaughtError("storage_api", error);

    return respond({ error: "failed" }, 500);
  }
}
