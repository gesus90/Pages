import type { RouteConfigEntry } from "@react-router/dev/routes";

/**
 * The agent panel and the read-only agent profiles of the user management (PAGE-266, PAGE-308).
 *
 * @param resource - Declares a server resource of the current route table.
 * @returns The resources under `/users-api/agents`, `/users-api/agent-profiles` and `/users-api/groups`.
 */
export function userProfileRoutes(
  resource: (path: string, file: string) => RouteConfigEntry,
): RouteConfigEntry[] {
  return [
    resource("users-api/agents/:agentId", "routes/users-agent-data.ts"),
    resource(
      "users-api/agent-profiles/:agentId",
      "routes/users-agent-profile-data.ts",
    ),
    resource(
      "users-api/groups/:groupId/agents",
      "routes/users-group-agents-data.ts",
    ),
  ];
}
