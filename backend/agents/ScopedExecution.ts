import type { TextExecutionInput } from "./TextExecution";

/** Authorizes one person for one connection from current persisted facts. */
export interface ExecutionAuthorizer {
  requireUser(userId: string, connectionId: string): Promise<void>;
}

/** Any run entry point whose input names the executing person. */
export interface ScopedRun<Input extends TextExecutionInput> {
  run(input: Input, signal: AbortSignal): Promise<string>;
}

/**
 * Puts the connection scope in front of every provider call.
 *
 * @remarks
 * Selection and offering are checked earlier, but only this check sits at the
 * execution point: a stale or tampered selection, a membership that changed
 * during a long chat answer or a caller that skipped the earlier checks all
 * end here, before any credential is read or any process is started.
 */
export class ScopedExecution<
  Input extends TextExecutionInput,
> implements ScopedRun<Input> {
  private readonly inner: ScopedRun<Input>;
  private readonly authorizer: ExecutionAuthorizer;

  public constructor(inner: ScopedRun<Input>, authorizer: ExecutionAuthorizer) {
    this.inner = inner;
    this.authorizer = authorizer;
  }

  /** Rejects with `accessDenied` before the wrapped execution is entered. */
  public async run(input: Input, signal: AbortSignal): Promise<string> {
    await this.authorizer.requireUser(input.userId, input.agent.connection.id);
    return this.inner.run(input, signal);
  }
}
