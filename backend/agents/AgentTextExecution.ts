import { isApiProvider } from "@/definition/AgentConnection";

import type { TextExecution, TextExecutionInput } from "./TextExecution";
import type { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";

/** Shares A7's credential-operation lock while choosing exactly the assigned adapter. */
export class AgentTextExecution implements TextExecution {
  private readonly api: TextExecution;
  private readonly cli: TextExecution;
  private readonly operations: AgentOperationRegistry;

  public constructor(
    api: TextExecution,
    cli: TextExecution,
    operations: AgentOperationRegistry,
  ) {
    this.api = api;
    this.cli = cli;
    this.operations = operations;
  }

  /** A role change cannot redirect an already resolved request. */
  public run(input: TextExecutionInput, signal: AbortSignal): Promise<string> {
    const execution = isApiProvider(input.agent.connection.provider)
      ? this.api
      : this.cli;
    return this.operations.run(input.agent.connection.id, "check", () =>
      execution.run(input, signal),
    );
  }
}
