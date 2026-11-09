import { isAcpProvider } from "@/definition/AgentConfiguration";

import type { CliSessionMcp } from "@/backend/agents/cli/CliSessionPlans";
import type { PlanBridgeGrants } from "./bridge/PlanBridgeGrants";
import type { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type {
  AgentRunReach,
  AgentRunScope,
  AgentRunTicket,
} from "@/definition/McpAuthorization";

/** The agent API operations a session may call, and the MCP tools that call them. */
const SESSION_OPERATIONS = [
  "ticket.read",
  "ticket.work.read",
  "ticket.work.save",
  "ticket.checklist.read",
  "ticket.checklist.setItem",
  "ticket.checklist.setItems",
] as const;
const SESSION_TOOLS = [
  "read_ticket",
  "read_ticket_work",
  "save_ticket_work",
  "read_ticket_checklist",
  "set_ticket_checklist_item",
  "set_ticket_checklist_items",
  "report_step_result",
  "update_step_progress",
] as const;
// Moving a bound ticket between statuses is offered only to a node that reports its own progress.
const STATUS_OPERATION = "ticket.setStatus";
const STATUS_TOOL = "set_ticket_status";

// The credential outlives the session limit a little, so a slow closing report still reaches Pages.
const CREDENTIAL_MARGIN_MS = 5 * 60_000;

/** Where a local session reaches the plan bridge of this Pages instance. */
export interface AgentPlanMcpSettings {
  /** The web and API address of this Pages instance for local processes. */
  readonly url: string;
}

/** The node a credential is issued for. */
export interface AgentPlanSessionGrant {
  readonly userId: string;
  readonly runId: string;
  /** The step, or the group a retained session serves. */
  readonly stepId: string;
  /** The process instance of the session, as its run record names it. */
  readonly instanceId: string;
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

/** Builds the same least-privilege Pages scope for local and remote attempts. */
export function planSessionScope(
  grant: Omit<AgentPlanSessionGrant, "instanceId">,
): AgentRunScope {
  return {
    runId: grant.runId,
    stepId: grant.stepId,
    operations:
      grant.reach === "tickets"
        ? [
            ...SESSION_OPERATIONS,
            ...(grant.canSetStatus ? [STATUS_OPERATION] : []),
          ]
        : [],
    tickets: grant.tickets,
    reach: grant.reach,
  };
}

/** The tool names a step of the given grant may call; `null` leaves the choice to the scope of the credential. */
export function planSessionTools(
  grant: Pick<AgentPlanSessionGrant, "reach" | "canSetStatus">,
): readonly string[] | null {
  if (grant.reach !== "tickets") return null;
  return [
    ...SESSION_TOOLS,
    ...(grant.canSetStatus === true ? [STATUS_TOOL] : []),
  ];
}

/** How a plan engine opens and ends the plan bridge access of its nodes. */
export interface AgentPlanSessionGrants {
  /** Issues the tool access of one node, or none for a ticket-bound reach without tickets. */
  grant(grant: AgentPlanSessionGrant): Promise<CliSessionMcp | null>;
  /** Ends the access of one node, or of every node of a run. */
  revoke(runId: string, stepId: string | null): Promise<number>;
}

/**
 * Gives the session of a node its own way to Pages; the API process owns it.
 *
 * @remarks
 * The node gets a fresh credential for its executor, which Pages keeps as a
 * hash for the upload and attachment checks, and the address of this
 * instance. With the `tickets` reach the credential is limited to reading the
 * bound tickets and setting their checklist entries; the `read` and `full`
 * reaches of an ACP agent cover every read or every operation of the
 * executor, under the normal checks of the executor's rights. The clear
 * credential never leaves this process. The session receives a random bearer
 * that exists only in the memory of {@link PlanBridgeGrants} and is accepted
 * only by the plan bridge of this process, while the step is active. The
 * grant ends when the node closes, whatever its outcome; a restart ends all of
 * them. An engine in another process reaches this class through the private
 * run API socket.
 */
export class AgentPlanSessionAccess implements AgentPlanSessionGrants {
  private readonly credentials: AgentRunCredentialService;
  private readonly settings: AgentPlanMcpSettings;
  private readonly grants: PlanBridgeGrants;

  public constructor(
    credentials: AgentRunCredentialService,
    settings: AgentPlanMcpSettings,
    grants: PlanBridgeGrants,
  ) {
    this.credentials = credentials;
    this.settings = settings;
    this.grants = grants;
  }

  /** Issues the tool access of one node, or none for a ticket-bound reach without tickets. */
  public async grant(
    grant: AgentPlanSessionGrant,
  ): Promise<CliSessionMcp | null> {
    if (grant.reach === "tickets" && grant.tickets.length === 0) return null;
    // A repeated request for the same step replaces its grant; it never adds a second capability.
    await this.revoke(grant.runId, grant.stepId);
    const issued = await this.credentials.issue(
      grant.userId,
      planSessionScope(grant),
      grant.lifetimeMs === 0 ? 0 : grant.lifetimeMs + CREDENTIAL_MARGIN_MS,
    );
    const bearer = this.grants.open({
      runId: grant.runId,
      stepId: grant.stepId,
      instanceId: grant.instanceId,
      token: issued.token,
      expiresAt: grant.lifetimeMs === 0 ? 0 : issued.expiresAt,
    });
    return {
      url: this.settings.url,
      token: bearer,
      tools: planSessionTools(grant),
    };
  }

  /**
   * Ends the access of one node, or of every node of a run.
   *
   * @returns How many credentials were still valid.
   */
  public async revoke(runId: string, stepId: string | null): Promise<number> {
    this.grants.revoke(runId, stepId);
    return this.credentials.revoke(runId, stepId);
  }
}
