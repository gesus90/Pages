import type { RouteConfigEntry } from "@react-router/dev/routes";

/**
 * The user management API of the stand-alone Pages MCP program, admitted by
 * the device token (PAGE-280).
 *
 * @param resource - Declares a server resource of the current route table.
 * @returns The resources under `/api/mcp/v1/users`, `roles`, `departments`,
 * `groups` and `administration`.
 */
export function mcpUserRoutes(
  resource: (path: string, file: string) => RouteConfigEntry,
): RouteConfigEntry[] {
  const base = "api/mcp/v1";
  const user = `${base}/users/:userId`;
  return [
    resource(
      `${base}/administration/options`,
      "routes/api-mcp-v1-administration-options.ts",
    ),
    resource(
      `${base}/administration/activity`,
      "routes/api-mcp-v1-administration-activity.ts",
    ),
    resource(`${base}/users`, "routes/api-mcp-v1-users.ts"),
    resource(user, "routes/api-mcp-v1-user.ts"),
    resource(`${user}/active`, "routes/api-mcp-v1-user-active.ts"),
    resource(
      `${user}/password-reset`,
      "routes/api-mcp-v1-user-password-reset.ts",
    ),
    resource(`${user}/departments`, "routes/api-mcp-v1-user-departments.ts"),
    resource(`${user}/scope`, "routes/api-mcp-v1-user-scope.ts"),
    resource(
      `${user}/administrator`,
      "routes/api-mcp-v1-user-administrator.ts",
    ),
    resource(`${user}/private-wiki`, "routes/api-mcp-v1-user-private-wiki.ts"),
    resource(`${base}/roles`, "routes/api-mcp-v1-roles.ts"),
    resource(`${base}/roles/:roleId`, "routes/api-mcp-v1-role.ts"),
    resource(
      `${base}/roles/:roleId/assign`,
      "routes/api-mcp-v1-role-assign.ts",
    ),
    resource(`${base}/departments`, "routes/api-mcp-v1-departments.ts"),
    resource(
      `${base}/departments/:departmentId`,
      "routes/api-mcp-v1-department.ts",
    ),
    resource(`${base}/groups`, "routes/api-mcp-v1-groups.ts"),
    resource(`${base}/groups/:groupId`, "routes/api-mcp-v1-group.ts"),
  ];
}
