import type { RouteConfigEntry } from "@react-router/dev/routes";

/** The calendar API of the stand-alone Pages MCP program, admitted by the device token (PAGE-301). */
export function mcpCalendarRoutes(routes: {
  readonly resource: (path: string, file: string) => RouteConfigEntry;
}): RouteConfigEntry[] {
  const { resource } = routes;
  const calendar = "api/mcp/v1/calendar";
  const event = `${calendar}/events/:eventId`;
  return [
    resource(`${calendar}/options`, "routes/api-mcp-v1-calendar-options.ts"),
    resource(`${calendar}/invitees`, "routes/api-mcp-v1-calendar-invitees.ts"),
    resource(`${calendar}/entries`, "routes/api-mcp-v1-calendar-entries.ts"),
    resource(`${calendar}/events`, "routes/api-mcp-v1-calendar-events.ts"),
    resource(event, "routes/api-mcp-v1-calendar-event.ts"),
    resource(
      `${event}/response`,
      "routes/api-mcp-v1-calendar-event-response.ts",
    ),
    resource(`${event}/delete`, "routes/api-mcp-v1-calendar-event-delete.ts"),
  ];
}
