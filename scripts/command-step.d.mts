/** Exit code of a step that ran into its time limit. */
export const TIMEOUT_EXIT_CODE: number;

/** Runs a command with cancellation, a deadline and process group cleanup. */
export function runStep(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly timeoutMilliseconds: number;
    readonly signal?: AbortSignal;
  },
): Promise<number>;
