import type { AccountAccess } from "@/definition/Authorization";
import type { ProjectActivitySource } from "@/definition/Project";

/** Selects the administrator interpretation at a server-owned read boundary. */
export type ActorChannel = "ui" | "mcp";

/**
 * The agent surface a Pages operation runs for.
 *
 * @remarks
 * MCP clients act with the MCP policy and mark their changes `mcp`. The chat
 * agent acts like the person in the interface, so the persisted role mode
 * decides about administration, and its changes are marked as AI actions.
 */
export type AgentChannel = "mcp" | "chat";

/** Administrator interpretation and activity marker that follow from an agent channel. */
export interface AgentChannelPolicy {
  readonly actor: ActorChannel;
  readonly source: ProjectActivitySource;
}

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

/** Resolves the policy of an agent channel; the server wiring alone chooses the channel. */
export function agentChannelPolicy(channel: AgentChannel): AgentChannelPolicy {
  return channel === "chat"
    ? { actor: "ui", source: "ai" }
    : { actor: "mcp", source: "mcp" };
}
