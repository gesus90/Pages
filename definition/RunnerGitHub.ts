/** Deploy-key operations expose their verification source explicitly. */
export interface RunnerDeployKey {
  readonly id: string;
  readonly key: string;
  readonly title: string;
}

export interface RunnerGitHubResult {
  readonly mode: "offline" | "http";
  readonly key: RunnerDeployKey | null;
  /** Unknown in offline mode; Pages configuration does not prove remote access. */
  readonly accessible: boolean | null;
  readonly repository: string;
}

/** Production boundary for key creation, key inspection and repository access inspection. */
export interface RunnerGitHubClient {
  createKey(input: {
    readonly projectId: string;
    readonly key: string;
    readonly title: string;
  }): Promise<RunnerGitHubResult>;
  checkKey(projectId: string, keyId: string): Promise<RunnerGitHubResult>;
  checkAccess(projectId: string): Promise<RunnerGitHubResult>;
}
