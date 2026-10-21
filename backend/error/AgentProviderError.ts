import { AgentError } from "./AgentErrors";

import type { AgentProviderFailure } from "@/definition/AgentPlanRetry";

/** Carries safe retry metadata without retaining the provider's diagnostic text. */
export class AgentProviderError extends AgentError {
  public readonly failure: AgentProviderFailure;

  public constructor(failure: AgentProviderFailure) {
    super(failure.code);
    this.name = "AgentProviderError";
    this.failure = failure;
  }
}
