import { z } from "zod";

import type { RuntimeExecutionContext } from "./RuntimeExecutionContext";

/** Schema binding for a native Pages handler; business rules stay in its service. */
export interface RuntimeToolDefinition<Input, Output> {
  readonly id: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<Input>;
  readonly outputSchema: z.ZodType<Output>;
  readonly execute: (
    input: Input,
    context: RuntimeExecutionContext,
  ) => Promise<Output>;
}

/** The public face of a tool for a transport over ACP, such as an MCP bridge. */
export interface RuntimeToolDescription {
  readonly id: string;
  readonly description: string;
  /** The JSON Schema of the input, derived from the handler’s Zod schema. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/** The result of one call over ACP: the validated output, or why the input was refused. */
export type RuntimeToolInvocation =
  | { readonly isValid: true; readonly output: unknown }
  | { readonly isValid: false; readonly output: null };

/** One registered tool, for the ACP transport. */
interface RegisteredTool {
  readonly description: RuntimeToolDescription;
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

/** Checks cancellation around the current server-side authorization. */
async function authorizedContext(
  context: RuntimeExecutionContext,
): Promise<RuntimeExecutionContext> {
  const { signal } = context;
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
      invoke: async (input, context) => {
        const parsed = binding.inputSchema.safeParse(input);
        if (!parsed.success) return { isValid: false, output: null };
        const authorized = await authorizedContext(context);
        const output = await binding.execute(parsed.data, authorized);
        return { isValid: true, output: binding.outputSchema.parse(output) };
      },
    });
  }

  /** Lists the registered tools for a transport over ACP. */
  public describe(): readonly RuntimeToolDescription[] {
    return [...this.tools.values()].map((tool) => tool.description);
  }

  /**
   * Runs one tool over ACP with the same schema, authorization and handler.
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
