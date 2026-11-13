import { RouterContextProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { loader, action } from "@/app/routes/api-mcp-v1-repository";
import { RepositoryReadError } from "@/definition/RepositoryRead";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  run: vi.fn(),
  authenticate: vi.fn(),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: mocks.get,
}));

function args(operation: string, query = ""): Parameters<typeof loader>[0] {
  const request = new Request(
    `http://pages/api/mcp/v1/repository/${operation}${query}`,
    { headers: { Authorization: "Bearer session" } },
  );
  return {
    request,
    context: new RouterContextProvider(),
    params: { operation },
    url: new URL(request.url),
    pattern: "/api/mcp/v1/repository/:operation",
  };
}

beforeEach(() => {
  mocks.run.mockReset();
  mocks.authenticate.mockResolvedValue({ id: "Ed" });
  mocks.get.mockResolvedValue({
    mcpUserApi: { authenticate: mocks.authenticate },
    repositoryReadService: { run: mocks.run },
  });
});

it("authenticates the agent and passes range and pagination to the read service", async () => {
  mocks.run.mockResolvedValue({ commits: [], nextPage: null });
  const response = await loader(
    args("log", "?projectId=pages&range=c5ee1978..3468b2db&page=2&limit=20"),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ commits: [], nextPage: null });
  expect(mocks.authenticate).toHaveBeenCalledWith("Bearer session");
  expect(mocks.run).toHaveBeenCalledWith("Ed", "repository_log", {
    projectId: "pages",
    range: "c5ee1978..3468b2db",
    page: 2,
    limit: 20,
  });
  expect(response.headers.get("Cache-Control")).toContain("no-store");
});

it("returns stable permission and input failures and exposes no write endpoint", async () => {
  mocks.run.mockRejectedValueOnce(new RepositoryReadError("FORBIDDEN"));
  const denied = await loader(
    args("file", "?projectId=private&commit=3468b2db&path=report.md"),
  );
  expect(denied.status).toBe(403);
  expect(await denied.json()).toEqual({ error: "FORBIDDEN" });
  mocks.run.mockRejectedValueOnce(new RepositoryReadError("INVALID_REQUEST"));
  expect((await loader(args("show"))).status).toBe(400);
  expect((await loader(args("push"))).status).toBe(404);
  expect(action().status).toBe(405);
  expect(action().headers.get("Allow")).toBe("GET");
});

it("keeps bearer-authenticated file resources separate from cookie-authenticated Storage settings", async () => {
  const { mcpFileRoutes, storageRoutes } =
    await import("@/app/lib/storage-routes");
  const resource = (
    path: string,
    file: string,
  ): { readonly path: string; readonly file: string } => ({ path, file });
  expect(mcpFileRoutes(resource)).toEqual([
    { path: "api/mcp/v1/storage/*", file: "routes/api-mcp-v1-storage.ts" },
    {
      path: "api/mcp/v1/repository/:operation",
      file: "routes/api-mcp-v1-repository.ts",
    },
  ]);
  expect(storageRoutes(resource)).toContainEqual({
    path: "storage-api/access",
    file: "routes/storage-access-api.ts",
  });
});
