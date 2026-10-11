import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { isApiProvider } from "@/definition/AgentConnection";

import type { TextExecution } from "./TextExecution";
import type { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";

/** Adapters settle before cancellation is reported or working-copy reservations are released. */
export interface PlanExecution {
  run(input: AgentPlanExecutionInput, signal: AbortSignal): Promise<string>;
}

/** Reuses credential boundaries and permits independent plan steps to share a verified connection. */
export class AgentPlanExecution implements PlanExecution {
  private readonly api: TextExecution;
  private readonly cli: PlanExecution;
  private readonly operations: AgentOperationRegistry;

  public constructor(
    api: TextExecution,
    cli: PlanExecution,
    operations: AgentOperationRegistry,
  ) {
    this.api = api;
    this.cli = cli;
    this.operations = operations;
  }

  /** Never redirects a pinned provider or passes credential material through a plan. */
  public async run(
    input: AgentPlanExecutionInput,
    signal: AbortSignal,
  ): Promise<string> {
    const release = this.operations.acquireExecution(input.agent.connection.id);
    try {
      if (!isApiProvider(input.agent.connection.provider))
        return await this.cli.run(input, signal);
      await input.beforeStart?.();
      const requestSignal = AbortSignal.any([
        signal,
        AbortSignal.timeout(120_000),
      ]);
      try {
        return await this.api.run(input, requestSignal);
      } catch (error: unknown) {
        if (signal.aborted) throw new AgentPlanCancelledError();
        if (requestSignal.aborted) throw new TextAssistantError("timeout");
        throw error;
      }
    } finally {
      release();
    }
  }
}
