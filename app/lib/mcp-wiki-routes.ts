import type { RouteConfigEntry } from "@react-router/dev/routes";

/**
 * The wiki API of the stand-alone Pages MCP program, admitted by the device token (PAGE-257).
 *
 * @param resource - Declares a server resource of the current route table.
 * @returns The resources under `/api/mcp/v1/wiki`.
 */
export function mcpWikiRoutes(
  resource: (path: string, file: string) => RouteConfigEntry,
): RouteConfigEntry[] {
  const wiki = "api/mcp/v1/wiki";
  const page = `${wiki}/pages/:id`;
  const version = `${page}/versions/:versionId`;
  const comment = `${wiki}/comments/:commentId`;
  return [
    resource(`${wiki}/pages`, "routes/api-mcp-v1-wiki-pages.ts"),
    resource(`${wiki}/search`, "routes/api-mcp-v1-wiki-search.ts"),
    resource(page, "routes/api-mcp-v1-wiki-page.ts"),
    resource(`${page}/duplicate`, "routes/api-mcp-v1-wiki-page-duplicate.ts"),
    resource(`${page}/move`, "routes/api-mcp-v1-wiki-page-move.ts"),
    resource(`${page}/properties`, "routes/api-mcp-v1-wiki-page-properties.ts"),
    resource(`${page}/patch`, "routes/api-mcp-v1-wiki-page-patch.ts"),
    resource(`${page}/delete`, "routes/api-mcp-v1-wiki-page-delete.ts"),
    resource(`${page}/versions`, "routes/api-mcp-v1-wiki-page-versions.ts"),
    resource(version, "routes/api-mcp-v1-wiki-page-version.ts"),
    resource(
      `${version}/restore`,
      "routes/api-mcp-v1-wiki-page-version-restore.ts",
    ),
    resource(`${page}/comments`, "routes/api-mcp-v1-wiki-page-comments.ts"),
    resource(
      `${page}/attachments`,
      "routes/api-mcp-v1-wiki-page-attachments.ts",
    ),
    resource(`${wiki}/trash`, "routes/api-mcp-v1-wiki-trash.ts"),
    resource(
      `${wiki}/trash/:id/restore`,
      "routes/api-mcp-v1-wiki-trash-restore.ts",
    ),
    resource(
      `${wiki}/trash/:id/purge`,
      "routes/api-mcp-v1-wiki-trash-purge.ts",
    ),
    resource(comment, "routes/api-mcp-v1-wiki-comment.ts"),
    resource(`${comment}/resolve`, "routes/api-mcp-v1-wiki-comment-resolve.ts"),
    resource(
      `${wiki}/attachments/:attachmentId`,
      "routes/api-mcp-v1-wiki-attachment.ts",
    ),
  ];
}
