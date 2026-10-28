import { beforeEach, expect, it, vi } from "vitest";

import { loader } from "@/app/routes/agent-workspace-choices";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { User } from "@/definition/User";

const services = vi.hoisted(() => ({
  agentWorkspaceService: { choices: vi.fn() },
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
      new Request(`http://pages.invalid/agent-api/workspace-choices${query}`),
      user,
      {},
    ),
  );
}

it("lists the workspace choices of the current user for a project", async () => {
  services.agentWorkspaceService.choices.mockResolvedValue([{ id: "w1" }]);

  const response = await read("?projectId=project-1");

  expect(services.agentWorkspaceService.choices).toHaveBeenCalledWith(
    EMPLOYEE.id,
    "project-1",
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ workspaces: [{ id: "w1" }] });
});

it("lists the choices without a project", async () => {
  services.agentWorkspaceService.choices.mockResolvedValue([]);

  await read("");

  expect(services.agentWorkspaceService.choices).toHaveBeenCalledWith(
    EMPLOYEE.id,
    null,
  );
});

it.each([
  ["a blank project", "?projectId="],
  ["an overlong project", `?projectId=${"p".repeat(101)}`],
])("refuses %s", async (caseName, query) => {
  const response = await read(query);

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: "workspace_invalid" });
  expect(services.agentWorkspaceService.choices).not.toHaveBeenCalled();
});

it("refuses a visitor", async () => {
  const response = await read("", null);

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    error: "workspace_access_denied",
  });
});
