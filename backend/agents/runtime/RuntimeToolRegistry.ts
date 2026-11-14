import { z } from "zod";

import type { RuntimeExecutionContext } from "./RuntimeExecutionContext";

/**
 * Who may use a tool: every person with a valid session, or only a person who
 * is a current administrator on this very call.
 */
export type RuntimeToolAccess = "user" | "administrator";

/** Schema binding for a native Pages handler; business rules stay in its service. */
export interface RuntimeToolDefinition<Input, Output> {
  readonly id: string;
  readonly description: string;
  /** Defaults to `user`; an `administrator` tool needs the registry's gate to admit the caller. */
  readonly access?: RuntimeToolAccess;
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
  readonly access: RuntimeToolAccess;
  /** The JSON Schema of the input, derived from the handler’s Zod schema. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/** The result of one call over ACP: the validated output, or why the input was refused. */
export type RuntimeToolInvocation =
  | { readonly isValid: true; readonly output: unknown }
  | { readonly isValid: false; readonly output: null };

/** A call that ended, as an observer of the registry hears of it. */
export interface RuntimeToolCall {
  readonly id: string;
  /** The untrusted arguments of the call. */
  readonly input: unknown;
  readonly invocation: RuntimeToolInvocation;
}

/** Selects what a transport lists; a person's own catalog never names administrator tools. */
export interface RuntimeToolListing {
  /** Lists the administrator tools too; defaults to `true`. */
  readonly includeAdministrator?: boolean;
}

/**
 * Decides on every call whether the caller is currently an administrator.
 *
 * @remarks
 * The answer comes from persisted account facts, never from the context or
 * the model. `false` means denied; an error means the answer is unknown and
 * the call fails.
 */
export type RuntimeAdministratorGate = (
  context: RuntimeExecutionContext,
  toolId: string,
) => Promise<boolean>;

/** The call of an administrator tool was refused before its handler ran. */
export class RuntimeToolDeniedError extends Error {
  public readonly toolId: string;

  public constructor(toolId: string) {
    super("Runtime tool requires a current administrator");
    this.name = "RuntimeToolDeniedError";
    this.toolId = toolId;
  }
}

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

/**
 * Registers schema-bound tools and enforces their access class before the handler runs.
 *
 * @remarks
 * Retries and execution loops stay outside. Business permissions stay in the
 * services behind the handlers; the registry only keeps an `administrator`
 * tool from running for anyone the gate does not admit, and from being listed
 * to them.
 */
export class RuntimeToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly gate: RuntimeAdministratorGate | undefined;
  private observer: ((call: RuntimeToolCall) => void) | null = null;

  /**
   * Creates a registry.
   *
   * @param gate - Admits administrators; without it every administrator tool is refused.
   */
  public constructor(gate?: RuntimeAdministratorGate) {
    this.gate = gate;
  }

  /** Rejects duplicate tool names instead of silently replacing an operation. */
  public register<Input, Output>(
    definition: RuntimeToolDefinition<Input, Output>,
  ): void {
    if (!/^[a-zA-Z0-9_-]+$/u.test(definition.id))
      throw new Error("Invalid runtime tool ID");
    if (this.tools.has(definition.id))
      throw new Error("Runtime tool already registered");
    const binding = Object.freeze({ ...definition });
    const access = binding.access ?? "user";
    this.tools.set(binding.id, {
      description: Object.freeze({
        id: binding.id,
        description: binding.description,
        access,
        inputSchema: toolInputSchema(binding.inputSchema),
      }),
      invoke: async (input, context) => {
        const parsed = binding.inputSchema.safeParse(input);
        if (!parsed.success) return { isValid: false, output: null };
        const authorized = await authorizedContext(context);
        if (access === "administrator")
          await this.requireAdministrator(binding.id, authorized);
        const output = await binding.execute(parsed.data, authorized);
        return { isValid: true, output: binding.outputSchema.parse(output) };
      },
    });
  }

  /**
   * Lists the registered tools for a transport over ACP.
   *
   * @param listing - Leaves the administrator tools out for a person who is none.
   */
  public describe(
    listing: RuntimeToolListing = {},
  ): readonly RuntimeToolDescription[] {
    const includeAdministrator = listing.includeAdministrator ?? true;
    return [...this.tools.values()]
      .map((tool) => tool.description)
      .filter(
        ({ access }) => includeAdministrator || access !== "administrator",
      );
  }

  /**
   * Hears of every call that ended with an answer, whether its input was valid
   * or not, such as for the record of an agent's tool use (PAGE-378). A call
   * that throws is not reported. The observer must not throw; a second one
   * replaces the first.
   *
   * @param observer - Called after each call.
   */
  public observe(observer: (call: RuntimeToolCall) => void): void {
    this.observer = observer;
  }

  /** The access class of a registered tool, or `null` for an unknown name. */
  public accessOf(id: string): RuntimeToolAccess | null {
    return this.tools.get(id)?.description.access ?? null;
  }

  /**
   * Runs one tool over ACP with the same schema, authorization and handler.
   *
   * @param id - The registered tool name.
   * @param input - The untrusted arguments of the call.
   * @param context - The invocation scope; it is reauthorized before the handler runs.
   * @returns The validated output, `isValid: false` for refused input, or `null`
   * for an unknown tool.
   * @throws {RuntimeToolDeniedError} For an administrator tool the gate does not admit.
   */
  public async invoke(
    id: string,
    input: unknown,
    context: RuntimeExecutionContext,
  ): Promise<RuntimeToolInvocation | null> {
    const tool = this.tools.get(id);
    if (!tool) return null;
    const invocation = await tool.invoke(input, context);
    this.observer?.({ id, input, invocation });
    return invocation;
  }

  private async requireAdministrator(
    toolId: string,
    context: RuntimeExecutionContext,
  ): Promise<void> {
    // Without a gate the answer is unknown, and unknown means no.
    if (!this.gate || !(await this.gate(context, toolId)))
      throw new RuntimeToolDeniedError(toolId);
    context.signal.throwIfAborted();
  }
}
