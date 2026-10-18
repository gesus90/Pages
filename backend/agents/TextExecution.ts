import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import type {
  AgentTicketInput,
  AgentTicketAssetContent,
} from "@/definition/AgentTicketParameter";

/** Provider execution accepts a resolved role, never a client-chosen provider. */
export interface TextExecutionInput {
  /** Structured provenance; file bytes are resolved afresh immediately before transmission. */
  readonly ticketInputs?: readonly AgentTicketInput[];
  readonly readTicketAssets?: () => Promise<readonly AgentTicketAssetContent[]>;
  readonly agent: ResolvedAgentAssignment;
  /**
   * The person on whose behalf the model runs.
   *
   * @remarks
   * The execution point authorizes this person against the scope of the
   * connection immediately before the provider is called, so a selection made
   * earlier never outlives a change of scope or membership.
   */
  readonly userId: string;
  readonly prompt: string;
  /** System instruction kept apart from the prompt where the provider supports it. */
  readonly instructions?: string;
  /** Lets the model use the search function of its provider, where Pages supports it. */
  readonly webSearch?: boolean;
}

export interface TextExecution {
  run(input: TextExecutionInput, signal: AbortSignal): Promise<string>;
}
