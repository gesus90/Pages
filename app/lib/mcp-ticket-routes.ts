import type { RouteBuilder } from "./route-builder";
import type { RouteConfigEntry } from "@react-router/dev/routes";

/** The ticket API of the stand-alone Pages MCP program, admitted by the device token (PAGE-242). */
export function mcpTicketRoutes(routes: RouteBuilder): RouteConfigEntry[] {
  const { resource } = routes;
  const tickets = "api/mcp/v1/tickets";
  const ticket = `${tickets}/:key`;
  return [
    resource(tickets, "routes/api-mcp-v1-tickets.ts"),
    resource(`${tickets}/options`, "routes/api-mcp-v1-tickets-options.ts"),
    resource(ticket, "routes/api-mcp-v1-ticket.ts"),
    resource(`${ticket}/history`, "routes/api-mcp-v1-ticket-history.ts"),
    resource(`${ticket}/position`, "routes/api-mcp-v1-ticket-position.ts"),
    resource(`${ticket}/move`, "routes/api-mcp-v1-ticket-move.ts"),
    resource(`${ticket}/checklist`, "routes/api-mcp-v1-ticket-checklist.ts"),
    resource(
      `${ticket}/checklist/:itemId`,
      "routes/api-mcp-v1-ticket-checklist-item.ts",
    ),
    resource(`${ticket}/links`, "routes/api-mcp-v1-ticket-links.ts"),
    resource(`${ticket}/links/:linkId`, "routes/api-mcp-v1-ticket-link.ts"),
    resource(
      `${ticket}/attachments`,
      "routes/api-mcp-v1-ticket-attachments.ts",
    ),
    resource(
      `${ticket}/attachments/:attachmentId`,
      "routes/api-mcp-v1-ticket-attachment.ts",
    ),
    resource(`${ticket}/archive`, "routes/api-mcp-v1-ticket-archive.ts"),
    resource(`${ticket}/restore`, "routes/api-mcp-v1-ticket-restore.ts"),
    resource(`${ticket}/delete`, "routes/api-mcp-v1-ticket-delete.ts"),
    resource("api/mcp/v1/ticket-labels", "routes/api-mcp-v1-ticket-labels.ts"),
    resource(
      "api/mcp/v1/ticket-labels/:labelId",
      "routes/api-mcp-v1-ticket-label.ts",
    ),
    resource(
      "api/mcp/v1/ticket-labels/:labelId/delete",
      "routes/api-mcp-v1-ticket-label-delete.ts",
    ),
    resource(
      "api/mcp/v1/ticket-templates",
      "routes/api-mcp-v1-ticket-templates.ts",
    ),
    resource(
      "api/mcp/v1/ticket-templates/:templateId",
      "routes/api-mcp-v1-ticket-template.ts",
    ),
  ];
}
