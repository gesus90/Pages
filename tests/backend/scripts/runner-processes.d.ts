declare module "@/scripts/runner/processes.mjs" {
  interface CleanupOptions {
    includeWorker?: boolean;
    removeRuntime?: boolean;
    onFailure?: (reason: string) => void;
  }

  export function accountTasks(): Promise<number>;
  export function rememberOwnership(folder: string): Promise<void>;
  export function cleanup(
    folder: string,
    jobId: string,
    options?: CleanupOptions,
  ): Promise<"confirmed" | "failed">;
}
