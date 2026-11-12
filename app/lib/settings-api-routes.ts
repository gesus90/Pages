import type { RouteConfigEntry } from "@react-router/dev/routes";

/**
 * The data endpoints of the settings pages, where the static app reads what
 * the pages show.
 *
 * @param resource - Declares a server resource of the current route table.
 * @returns The resources under `/settings-api`.
 */
export function settingsApiRoutes(
  resource: (path: string, file: string) => RouteConfigEntry,
): RouteConfigEntry[] {
  return [
    resource(
      "settings-api/agents/:connectionId/login",
      "routes/settings-agents-login.ts",
    ),
    resource("settings-api/runners", "routes/settings-runners.ts"),
    resource("settings-api/navigation", "routes/settings-data.ts"),
    resource("settings-api/profile", "routes/settings-profile-data.ts"),
    resource("settings-api/connections", "routes/settings-connections-data.ts"),
    resource("settings-api/system", "routes/settings-system-data.ts"),
    resource("settings-api/agents", "routes/settings-agents-data.ts"),
    resource("settings-api/agent-tools", "routes/settings-agent-tools-data.ts"),
  ];
}
