/** Private command scratch and a signal that requests child shutdown. */
export interface CommandTemporaryDirectory {
  readonly directory: string;
  readonly signal: AbortSignal;
}
/** Runs work with private scratch and removes it after child shutdown, also on errors. */
export function withCommandTemporaryDirectory<Result>(
  run: (context: CommandTemporaryDirectory) => Promise<Result>,
): Promise<Result>;
