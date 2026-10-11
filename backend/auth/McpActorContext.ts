import type { AccountAccess } from "@/definition/Authorization";

/** Selects the administrator interpretation at a server-owned read boundary. */
export type ActorChannel = "ui" | "mcp";

/**
 * Derives MCP policy facts from a fresh persisted account, without changing its UI mode.
 * Only the MCP read services choose this channel; tool parameters never select it.
 */
export function accountForChannel(
  account: AccountAccess,
  channel: ActorChannel,
): AccountAccess {
  return channel === "mcp" && account.isAdmin
    ? { ...account, mode: "admin" }
    : account;
}
