import { beforeEach, expect, it, vi } from "vitest";

import { loader } from "@/app/routes/agent-workspace-folders";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { User } from "@/definition/User";

const services = vi.hoisted(() => ({
  agentWorkspaceService: { folders: vi.fn() },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

beforeEach(() => {
  vi.resetAllMocks();
});

async function read(
  query: string,
  user: User | null = EMPLOYEE,
): Promise<Response> {
  return loader(
    routeArguments(
      new Request(`http://pages.invalid/agent-api/workspace-folders${query}`),
      user,
      {},
    ),
  );
}

it("lists the folders of a path with hidden entries on request", async () => {
  services.agentWorkspaceService.folders.mockResolvedValue({ folders: ["a"] });

  const response = await read("?path=%2Fsrv&hidden=1");

  expect(services.agentWorkspaceService.folders).toHaveBeenCalledWith(
    EMPLOYEE.id,
    { path: "/srv", showHidden: true },
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ folders: ["a"] });
});

it("starts at the default folder without hidden entries", async () => {
  services.agentWorkspaceService.folders.mockResolvedValue({ folders: [] });

  await read("?hidden=yes");

  expect(services.agentWorkspaceService.folders).toHaveBeenCalledWith(
    EMPLOYEE.id,
    { path: null, showHidden: false },
  );
});

it("refuses an overlong path", async () => {
  const response = await read(`?path=${"a".repeat(4097)}`);

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: "workspace_path_invalid",
  });
  expect(services.agentWorkspaceService.folders).not.toHaveBeenCalled();
});

it("refuses a visitor", async () => {
  const response = await read("", null);

  expect(response.status).toBe(403);
  expect(services.agentWorkspaceService.folders).not.toHaveBeenCalled();
});
