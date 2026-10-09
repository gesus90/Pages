import type { ResolvedTextAgent } from "@/backend/service/assistant/TextAgentRoleService";

/** Provider execution accepts a resolved role, never a client-chosen provider. */
export interface TextExecutionInput {
  readonly agent: ResolvedTextAgent;
  readonly prompt: string;
}

export interface TextExecution {
  run(input: TextExecutionInput, signal: AbortSignal): Promise<string>;
}
