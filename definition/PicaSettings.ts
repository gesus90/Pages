import type { AgentModelSelection } from "./AgentModelSelection";
import type { AgentRunOptions } from "./AgentConfiguration";
import type { AgentExecutionErrorCode } from "@/backend/error/AgentExecutionErrors";
import type { PageAgentModel } from "./PageAgent";

/** The single system-wide Pica switch and its exact routing; no personal override. */
export interface PicaSettings {
  readonly isEnabled: boolean;
  readonly selection: AgentModelSelection | null;
  /** Preserves the existing runner contract during the transition. */
  readonly run: AgentRunOptions | null;
  readonly revision: number;
}

/** Administration sees saved choices even when they have become unavailable. */
export interface PicaAdministration extends PicaSettings {
  readonly error: AgentExecutionErrorCode | null;
  /** Exact OpenCode equivalent, proposed without changing the saved selection until confirmation. */
  readonly adoption?: PageAgentModel & AgentModelSelection;
}
