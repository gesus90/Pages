import type { RouteConfigEntry } from "@react-router/dev/routes";

/**
 * The Google Drive connection and the Storage resources (PAGE-170, PAGE-188, PAGE-270).
 *
 * @param resource - Declares a server resource of the current route table.
 * @returns The sign-in endpoints of the system settings, the folder view of
 * Storage and the Storage interface `/storage-api/v1/:operation`.
 */
export function storageRoutes(
  resource: (path: string, file: string) => RouteConfigEntry,
): RouteConfigEntry[] {
  return [
    resource("settings-api/google-drive", "routes/settings-google-drive.ts"),
    resource(
      "settings-api/google-drive/callback",
      "routes/settings-google-drive-callback.ts",
    ),
    resource("storage-api", "routes/storage-api.ts"),
    resource("storage-api/v1/:operation", "routes/storage-api-v1.ts"),
  ];
}
