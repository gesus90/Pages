import { constants } from "node:fs";
import { access } from "node:fs/promises";

import { AgentError } from "@/backend/error/AgentErrors";
import { isAcpProvider } from "@/definition/AgentConfiguration";
import { logCaughtError } from "@/backend/logging/Logger";

import type { CliSessionMcp } from "@/backend/agents/cli/CliSessionPlans";
import type { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type {
  AgentRunReach,
  AgentRunTicket,
} from "@/definition/McpAuthorization";

/** The agent API operations a session may call, and the MCP tools that call them. */
const SESSION_OPERATIONS = [
  "ticket.read",
  "ticket.checklist.read",
  "ticket.checklist.setItem",
  "ticket.checklist.setItems",
] as const;
const SESSION_TOOLS = [
  "read_ticket",
  "read_ticket_checklist",
  "set_ticket_checklist_item",
  "set_ticket_checklist_items",
] as const;
// Moving a bound ticket between statuses is offered only to a node that reports its own progress.
const STATUS_OPERATION = "ticket.setStatus";
const STATUS_TOOL = "set_ticket_status";

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
  readonly reach: AgentRunReach;
  /**
   * Whether a `tickets` reach also moves the bound tickets between statuses,
   * as a node that completes by its todo list does. The other reaches already
   * follow the rights of the executor.
   */
  readonly canSetStatus?: boolean;
}

/**
 * How far the Pages MCP access of a node reaches.
 *
 * @param provider - The runner of the node.
 * @param options - The run options the runner applies.
 * @returns For an ACP agent (Codex CLI, Claude Code or OpenCode) every read in "Nur
 * Lesen" and everything its executor may do in YOLO; for every other runner
 * the bound tickets, as before.
 */
export function planSessionReach(
  provider: AgentProviderId,
  options: AgentRunOptions,
): AgentRunReach {
  if (!isAcpProvider(provider)) return "tickets";
  return options.access === "yolo" ? "full" : "read";
}

/**
 * Gives the session of a node its own way to Pages.
 *
 * @remarks
 * The session gets a fresh credential for its executor and the address of
 * this instance. With the `tickets` reach the credential is limited to reading
 * the bound tickets and setting their checklist entries; the `read` and
 * `full` reaches of an ACP agent cover every read or every operation of the
 * executor, under the normal checks of the executor's rights. Credential
 * and address reach the local MCP process only through its environment. The
 * credential is revoked when the node closes.
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
   * Issues the MCP access of one node, or none for a ticket-bound reach without tickets.
   *
   * @throws {AgentError} `plan_mcp_unavailable` when the node needs MCP and
   * this server has no readable bundle.
   */
  public async grant(
    grant: AgentPlanSessionGrant,
  ): Promise<CliSessionMcp | null> {
    if (grant.reach === "tickets" && grant.tickets.length === 0) return null;
    const { bundle } = this.settings;
    if (bundle === null) throw new AgentError("plan_mcp_unavailable");
    try {
      await access(bundle, constants.R_OK);
    } catch (caughtError: unknown) {
      logCaughtError("AgentPlanSessionAccess", caughtError);

      throw new AgentError("plan_mcp_unavailable");
    }
    const withStatus = grant.canSetStatus === true;
    const issued = await this.credentials.issue(
      grant.userId,
      {
        runId: grant.runId,
        stepId: grant.stepId,
        operations:
          grant.reach === "tickets"
            ? [...SESSION_OPERATIONS, ...(withStatus ? [STATUS_OPERATION] : [])]
            : [],
        tickets: grant.tickets,
        reach: grant.reach,
      },
      grant.lifetimeMs === 0 ? 0 : grant.lifetimeMs + CREDENTIAL_MARGIN_MS,
    );
    return {
      node: this.settings.node,
      bundle,
      url: this.settings.url,
      token: issued.token,
      tools:
        grant.reach === "tickets"
          ? [...SESSION_TOOLS, ...(withStatus ? [STATUS_TOOL] : [])]
          : null,
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
