import type { RouteConfigEntry } from "@react-router/dev/routes";

/** The parts of the route builder of `app/routes.ts` the automation routes use. */
interface AutomationRouteBuilder {
  readonly resource: (path: string, file: string) => RouteConfigEntry;
  readonly page: (
    path: string,
    modules: { readonly browser: string; readonly server?: string },
  ) => RouteConfigEntry[];
}

/**
 * The page of automations, its data and the reads of a run (PAGE-297).
 *
 * @param routes - Declares pages and resources of the current route table.
 */
export function automationRoutes(
  routes: AutomationRouteBuilder,
): RouteConfigEntry[] {
  const { resource, page } = routes;
  return [
    ...page("automationen", {
      browser: "routes/automations.tsx",
      server: "routes/automations-server.ts",
    }),
    resource("automationen-api/page", "routes/automations-data.ts"),
    resource(
      "automationen-api/runs/:automationId/:runId",
      "routes/automations-run-data.ts",
    ),
  ];
}
