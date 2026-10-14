import { constants } from "node:fs";
import { access } from "node:fs/promises";

import { AgentError } from "@/backend/error/AgentErrors";

import type { CliSessionMcp } from "@/backend/agents/cli/CliSessionPlans";
import type { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import type { AgentRunTicket } from "@/definition/McpAuthorization";

/** The agent API operations a session may call, and the MCP tools that call them. */
const SESSION_OPERATIONS = [
  "ticket.read",
  "ticket.checklist.read",
  "ticket.checklist.setItem",
] as const;
const SESSION_TOOLS = [
  "read_ticket",
  "read_ticket_checklist",
  "set_ticket_checklist_item",
] as const;

// The credential outlives the session limit a little, so a slow closing report still reaches Pages.
const CREDENTIAL_MARGIN_MS = 5 * 60_000;

/** Where the local MCP process of a session comes from and where it reaches Pages. */
export interface AgentPlanMcpSettings {
  /** The built Pages MCP bundle; `null` when the server has none. */
  readonly bundle: string | null;
  /** The web and API address of this Pages instance for local processes. */
  readonly url: string;
  /** The Node binary that runs the bundle. */
  readonly node: string;
}

/** The node a credential is issued for. */
export interface AgentPlanSessionGrant {
  readonly userId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly tickets: readonly AgentRunTicket[];
  readonly lifetimeMs: number;
}

/**
 * Gives the session of a ticket-bound node its own way to Pages.
 *
 * @remarks
 * The session gets a fresh credential for its executor, limited to reading
 * the bound tickets and setting their checklist entries, and the address of
 * this instance. Both reach the local MCP process only through the process
 * environment. The credential is revoked when the node closes.
 */
export class AgentPlanSessionAccess {
  private readonly credentials: AgentRunCredentialService;
  private readonly settings: AgentPlanMcpSettings;

  public constructor(
    credentials: AgentRunCredentialService,
    settings: AgentPlanMcpSettings,
  ) {
    this.credentials = credentials;
    this.settings = settings;
  }

  /**
   * Issues the MCP access of one node, or none for a node without tickets.
   *
   * @throws {AgentError} `plan_mcp_unavailable` when the node needs MCP and
   * this server has no readable bundle.
   */
  public async grant(
    grant: AgentPlanSessionGrant,
  ): Promise<CliSessionMcp | null> {
    if (grant.tickets.length === 0) return null;
    const { bundle } = this.settings;
    if (bundle === null) throw new AgentError("plan_mcp_unavailable");
    try {
      await access(bundle, constants.R_OK);
    } catch {
      throw new AgentError("plan_mcp_unavailable");
    }
    const issued = await this.credentials.issue(
      grant.userId,
      {
        runId: grant.runId,
        stepId: grant.stepId,
        operations: SESSION_OPERATIONS,
        tickets: grant.tickets,
      },
      grant.lifetimeMs === 0 ? 0 : grant.lifetimeMs + CREDENTIAL_MARGIN_MS,
    );
    return {
      node: this.settings.node,
      bundle,
      url: this.settings.url,
      token: issued.token,
      tools: SESSION_TOOLS,
    };
  }

  /**
   * Ends the MCP access of one node, or of every node of a run.
   *
   * @returns How many credentials were still valid.
   */
  public async revoke(runId: string, stepId: string | null): Promise<number> {
    return this.credentials.revoke(runId, stepId);
  }
}
