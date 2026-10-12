import { isApiProvider } from "@/definition/AgentConnection";

import type { TextExecution, TextExecutionInput } from "./TextExecution";
import type { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";

/**
 * How a run holds its connection: `exclusive` like a check, or `shared` with
 * other runs, which still blocks logins and credential changes.
 */
export type TextExecutionLock = "exclusive" | "shared";

/** Shares A7's credential-operation lock while choosing exactly the assigned adapter. */
export class AgentTextExecution implements TextExecution {
  private readonly api: TextExecution;
  private readonly cli: TextExecution;
  private readonly operations: AgentOperationRegistry;
  private readonly lock: TextExecutionLock;

  public constructor(
    api: TextExecution,
    cli: TextExecution,
    operations: AgentOperationRegistry,
    lock: TextExecutionLock = "exclusive",
  ) {
    this.api = api;
    this.cli = cli;
    this.operations = operations;
    this.lock = lock;
  }

  /** A role change cannot redirect an already resolved request. */
  public async run(
    input: TextExecutionInput,
    signal: AbortSignal,
  ): Promise<string> {
    const execution = isApiProvider(input.agent.connection.provider)
      ? this.api
      : this.cli;
    if (this.lock === "exclusive")
      return this.operations.run(input.agent.connection.id, "check", () =>
        execution.run(input, signal),
      );
    const release = this.operations.acquireExecution(input.agent.connection.id);
    try {
      return await execution.run(input, signal);
    } finally {
      release();
    }
  }
}
