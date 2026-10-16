import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import type { ToolsInput } from "@mastra/core/agent";
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

/** The public face of a tool for a transport outside Mastra, such as an MCP bridge. */
export interface RuntimeToolDescription {
  readonly id: string;
  readonly description: string;
  /** The JSON Schema of the input, derived from the same Zod schema Mastra validates. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/** The result of one call outside Mastra: the validated output, or why the input was refused. */
export type RuntimeToolInvocation =
  | { readonly isValid: true; readonly output: unknown }
  | { readonly isValid: false; readonly output: null };

/** One registered tool, as both transports dispatch it. */
interface RegisteredTool {
  readonly description: RuntimeToolDescription;
  readonly bind: (context: RuntimeExecutionContext) => ToolsInput[string];
  readonly invoke: (
    input: unknown,
    context: RuntimeExecutionContext,
  ) => Promise<RuntimeToolInvocation>;
}

/** The JSON Schema of a tool input, without the dialect marker some tool callers reject. */
function toolInputSchema(schema: z.ZodType): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(z.toJSONSchema(schema)).filter(([key]) => key !== "$schema"),
  );
}

/** Combines the Pages signal with the cancellation of one call, then reauthorizes. */
async function authorizedContext(
  context: RuntimeExecutionContext,
  callSignal: AbortSignal | undefined,
): Promise<RuntimeExecutionContext> {
  const signal = callSignal
    ? AbortSignal.any([context.signal, callSignal])
    : context.signal;
  signal.throwIfAborted();
  await context.authorize();
  signal.throwIfAborted();
  return Object.freeze({ ...context, signal });
}

/** Registers schema-bound tools without owning permissions, retries or execution loops. */
export class RuntimeToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  /** Rejects duplicate tool names instead of silently replacing an operation. */
  public register<Input, Output>(
    definition: RuntimeToolDefinition<Input, Output>,
  ): void {
    if (!/^[a-zA-Z0-9_-]+$/u.test(definition.id))
      throw new Error("Invalid runtime tool ID");
    if (this.tools.has(definition.id))
      throw new Error("Runtime tool already registered");
    const binding = Object.freeze({ ...definition });
    this.tools.set(binding.id, {
      description: Object.freeze({
        id: binding.id,
        description: binding.description,
        inputSchema: toolInputSchema(binding.inputSchema),
      }),
      bind: (context) =>
        createTool({
          id: binding.id,
          description: binding.description,
          inputSchema: binding.inputSchema,
          outputSchema: binding.outputSchema,
          requireApproval: binding.requireApproval,
          execute: async (input, execution) =>
            binding.execute(
              input,
              await authorizedContext(context, execution.abortSignal),
            ),
        }),
      invoke: async (input, context) => {
        const parsed = binding.inputSchema.safeParse(input);
        if (!parsed.success) return { isValid: false, output: null };
        const authorized = await authorizedContext(context, undefined);
        const output = await binding.execute(parsed.data, authorized);
        return { isValid: true, output: binding.outputSchema.parse(output) };
      },
    });
  }

  /** Creates isolated closures; mutable Mastra metadata cannot replace their identity. */
  public bind(context: RuntimeExecutionContext): ToolsInput {
    return Object.fromEntries(
      [...this.tools].map(([id, tool]) => [id, tool.bind(context)]),
    );
  }

  /** Lists the registered tools for a transport outside Mastra. */
  public describe(): readonly RuntimeToolDescription[] {
    return [...this.tools.values()].map((tool) => tool.description);
  }

  /**
   * Runs one tool outside Mastra with the same schema, authorization and handler.
   *
   * @param id - The registered tool name.
   * @param input - The untrusted arguments of the call.
   * @param context - The invocation scope; it is reauthorized before the handler runs.
   * @returns The validated output, `isValid: false` for refused input, or `null`
   * for an unknown tool.
   */
  public async invoke(
    id: string,
    input: unknown,
    context: RuntimeExecutionContext,
  ): Promise<RuntimeToolInvocation | null> {
    const tool = this.tools.get(id);
    return tool ? tool.invoke(input, context) : null;
  }
}
