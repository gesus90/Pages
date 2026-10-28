/** Current availability problem of an authorized remote workspace's runner. */
export type AgentPlanRemoteStatusProblem =
  | "remoteOffline"
  | "remoteIdentity"
  | "remoteWorkspace"
  | "remoteRunnerUpdate"
  | "remoteCatalogStale";
