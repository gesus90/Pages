/** What the `/mcp` command of an ACP adapter says about one MCP server. */
export type McpServerStatus = "connected" | "connecting" | "failed" | "unknown";

// The groups the adapter lists its servers under, as it titles them.
const GROUP_STATUS: Readonly<Record<string, McpServerStatus>> = {
  connected: "connected",
  connecting: "connecting",
  failed: "failed",
  "needs authentication": "failed",
};

const GROUP_HEADING = /^\*\*([^*]+)\*\*\s*$/u;
const SERVER_LINE = /^[-*]\s+`([^`]+)`/u;

/**
 * Reads the status of one MCP server from the text of the `/mcp` command.
 *
 * @param text - The Markdown the adapter answered the command with.
 * @param server - The name of the server in the session.
 * @returns The group the server is listed under; `unknown` when the text
 * does not list it, so a changed format never fails a node by itself.
 *
 * @remarks
 * A server that needs authentication counts as failed: nobody can sign in to
 * it during an unattended run.
 */
export function readMcpServerStatus(
  text: string,
  server: string,
): McpServerStatus {
  let status: McpServerStatus = "unknown";
  for (const line of text.split("\n")) {
    const heading = GROUP_HEADING.exec(line.trim());
    if (heading?.[1] !== undefined) {
      status = GROUP_STATUS[heading[1].trim().toLowerCase()] ?? "unknown";
      continue;
    }
    if (SERVER_LINE.exec(line.trim())?.[1] === server) return status;
  }
  return "unknown";
}
