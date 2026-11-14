/** Immutable owner of one remote plan attempt. */
export interface RunnerTemporaryOwner {
  readonly jobId: string;
  readonly plan: { readonly runId: string; readonly stepId: string };
}
/** The account's disk scratch for this remote attempt. */
export function runnerTemporaryDirectory(job: RunnerTemporaryOwner): string;
/** Creates private scratch before spawning a namespace. */
export function prepareRunnerTemporaryDirectory(
  job: RunnerTemporaryOwner,
): Promise<string>;
/** Removes scratch only after the caller confirmed namespace end. */
export function removeRunnerTemporaryDirectory(
  job: RunnerTemporaryOwner | null,
): Promise<void>;
