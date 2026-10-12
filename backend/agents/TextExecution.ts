import type { ResolvedTextAgent } from "@/backend/service/assistant/TextAgentRoleService";

/** Provider execution accepts a resolved role, never a client-chosen provider. */
export interface TextExecutionInput {
  readonly agent: ResolvedTextAgent;
  readonly prompt: string;
  /** System instruction kept apart from the prompt where the provider supports it. */
  readonly instructions?: string;
  /** Lets the model use the search function of its provider, where Pages supports it. */
  readonly webSearch?: boolean;
}

export interface TextExecution {
  run(input: TextExecutionInput, signal: AbortSignal): Promise<string>;
}
