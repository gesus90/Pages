import { afterEach, expect, it, vi } from "vitest";

import type { RouteConfigEntry } from "@react-router/dev/routes";

function flatten(entries: RouteConfigEntry[]): RouteConfigEntry[] {
  return entries.flatMap((entry) => [entry, ...flatten(entry.children ?? [])]);
}

async function routesFor(target: string): Promise<RouteConfigEntry[]> {
  vi.resetModules();
  vi.stubEnv("PAGES_ROUTES", target);
  const routes = await import("@/app/routes");
  return flatten(routes.default);
}

afterEach(() => vi.unstubAllEnvs());

it("forwards resource requests and uses browser modules in the SPA", async () => {
  const routes = await routesFor("spa");
  expect(routes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "dashboard",
        file: "routes/dashboard.tsx",
      }),
      expect.objectContaining({
        path: "wiki-api/search",
        file: "routes/backend-request.ts",
        id: "forward:wiki-api/search",
      }),
    ]),
  );
});

it("uses server modules and real resources in the API table", async () => {
  const routes = await routesFor("api");
  expect(routes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ file: "routes/root-server.ts" }),
      expect.objectContaining({
        path: "dashboard",
        file: "routes/dashboard-server.ts",
      }),
      expect.objectContaining({
        path: "wiki-api/search",
        file: "routes/wiki-search.ts",
      }),
    ]),
  );
});

it("combines both tables for type generation and defaults unknown targets to SPA", async () => {
  const all = await routesFor("all");
  expect(all.some((entry) => entry.file === "routes/dashboard.tsx")).toBe(true);
  expect(all.some((entry) => entry.file === "routes/dashboard-server.ts")).toBe(
    true,
  );
  const fallback = await routesFor("invalid");
  expect(fallback.some((entry) => entry.file === "routes/dashboard.tsx")).toBe(
    true,
  );
  expect(
    fallback.some((entry) => entry.file === "routes/dashboard-server.ts"),
  ).toBe(false);
});
