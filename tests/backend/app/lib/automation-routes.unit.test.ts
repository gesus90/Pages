import { expect, it, vi } from "vitest";

import { automationRoutes } from "@/app/lib/automation-routes";

it("registers the automation page and its data resources in order", () => {
  const page = vi.fn(() => [{ file: "page" }]);
  const resource = vi.fn((path: string, file: string) => ({ path, file }));
  expect(automationRoutes({ page, resource })).toEqual([
    { file: "page" },
    { path: "automationen-api/page", file: "routes/automations-data.ts" },
    {
      path: "automationen-api/runs/:automationId/:runId",
      file: "routes/automations-run-data.ts",
    },
  ]);
  expect(page).toHaveBeenCalledWith("automationen", {
    browser: "routes/automations.tsx",
    server: "routes/automations-server.ts",
  });
});
