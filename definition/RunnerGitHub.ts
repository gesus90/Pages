/** Deploy-key operations expose their verification source explicitly. */
export interface RunnerDeployKey {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly readOnly?: boolean;
}

export interface RunnerGitHubResult {
  readonly mode: "offline" | "http" | "ssh";
  readonly key: RunnerDeployKey | null;
  /** Unknown in offline mode; Pages configuration does not prove remote access. */
  readonly accessible: boolean | null;
  readonly repository: string;
  /** Actual SSH probes or explicit HTTP policy; never inferred from offline metadata. */
  readonly readAccess?: boolean | null;
  readonly writeAccess?: boolean | null;
  readonly accessStatus?:
    "read_write" | "read_only" | "no_access" | "unverifiable";
  readonly readReason?: "verified" | "denied" | "unavailable";
  readonly writeReason?: "verified" | "denied" | "unavailable";
}

/** Production boundary for key creation, key inspection and repository access inspection. */
export interface RunnerGitHubClient {
  createKey(input: {
    readonly projectId: string;
    readonly key: string;
    readonly title: string;
  }): Promise<RunnerGitHubResult>;
  checkKey(projectId: string, keyId: string): Promise<RunnerGitHubResult>;
  checkAccess(
    projectId: string,
    publicKey?: string,
  ): Promise<RunnerGitHubResult>;
}
