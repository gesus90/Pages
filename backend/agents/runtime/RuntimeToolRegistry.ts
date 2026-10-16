import { createTool } from "@mastra/core/tools";

import type { ToolsInput } from "@mastra/core/agent";
import type { z } from "zod";
import type { RuntimeExecutionContext } from "./RuntimeExecutionContext";

/** Schema binding for a native Pages handler; business rules stay in its service. */
export interface RuntimeToolDefinition<Input, Output> {
  readonly id: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<Input>;
  readonly outputSchema: z.ZodType<Output>;
  /** Additional Mastra gate; never substitutes for Pages confirmation. */
  readonly requireApproval?: boolean;
  readonly execute: (
    input: Input,
    context: RuntimeExecutionContext,
  ) => Promise<Output>;
}

/** Registers schema-bound tools without owning permissions, retries or execution loops. */
export class RuntimeToolRegistry {
  private readonly factories = new Map<
    string,
    (context: RuntimeExecutionContext) => ToolsInput[string]
  >();

  /** Rejects duplicate tool names instead of silently replacing an operation. */
  public register<Input, Output>(
    definition: RuntimeToolDefinition<Input, Output>,
  ): void {
    if (!/^[a-zA-Z0-9_-]+$/u.test(definition.id))
      throw new Error("Invalid runtime tool ID");
    if (this.factories.has(definition.id))
      throw new Error("Runtime tool already registered");
    const binding = Object.freeze({ ...definition });
    this.factories.set(binding.id, (context) =>
      createTool({
        id: binding.id,
        description: binding.description,
        inputSchema: binding.inputSchema,
        outputSchema: binding.outputSchema,
        requireApproval: binding.requireApproval,
        execute: async (input, execution) => {
          const signal = execution.abortSignal
            ? AbortSignal.any([context.signal, execution.abortSignal])
            : context.signal;
          signal.throwIfAborted();
          await context.authorize();
          signal.throwIfAborted();
          return binding.execute(input, Object.freeze({ ...context, signal }));
        },
      }),
    );
  }

  /** Creates isolated closures; mutable Mastra metadata cannot replace their identity. */
  public bind(context: RuntimeExecutionContext): ToolsInput {
    return Object.fromEntries(
      [...this.factories].map(([id, factory]) => [id, factory(context)]),
    );
  }
}
