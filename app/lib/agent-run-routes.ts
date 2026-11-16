import type { RouteConfigEntry } from "@react-router/dev/routes";

/** The routes the browser reads plan runs through: polling, summaries, the run view and the swarm memory. */
export function agentRunRoutes(routes: {
  readonly resource: (path: string, file: string) => RouteConfigEntry;
  readonly page: (
    path: string,
    modules: { readonly browser: string; readonly server?: string },
  ) => RouteConfigEntry[];
}): RouteConfigEntry[] {
  const { resource, page } = routes;
  return [
    resource("agent-api/plan-runs", "routes/agent-plan-runs.ts"),
    resource("agent-api/run-diagnosis", "routes/agent-run-diagnosis.ts"),
    resource(
      "agent-api/plan-run-summaries",
      "routes/agent-plan-run-summaries.ts",
    ),
    resource(
      "agent-api/plan-runs/:runId/steps/:stepId/swarm-memory",
      "routes/agent-plan-swarm-memory.ts",
    ),
    resource(
      "agent-api/plan-runs/:runId/steps/:stepId/swarm-memory/:file",
      "routes/agent-plan-swarm-memory-export.ts",
    ),
    ...page("agents/runs", { browser: "routes/agent-runs.tsx" }),
  ];
}
