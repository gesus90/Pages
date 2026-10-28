import { beforeEach, expect, it, vi } from "vitest";

import { loader } from "@/app/routes/agent-definitions";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { User } from "@/definition/User";

const services = vi.hoisted(() => ({
  agentProfileService: { catalog: vi.fn() },
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
      new Request(`http://pages.invalid/agent-api/definitions${query}`),
      user,
      {},
    ),
  );
}

it("lists the reusable content of the current user for a project", async () => {
  services.agentProfileService.catalog.mockResolvedValue([{ id: "a1" }]);

  const response = await read("?projectId=project-1");

  expect(services.agentProfileService.catalog).toHaveBeenCalledWith(
    EMPLOYEE.id,
    "project-1",
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ agents: [{ id: "a1" }] });
});

it("lists the content without a project", async () => {
  services.agentProfileService.catalog.mockResolvedValue([]);

  await read("");

  expect(services.agentProfileService.catalog).toHaveBeenCalledWith(
    EMPLOYEE.id,
    null,
  );
});

it.each([
  ["a blank project", "?projectId=%20"],
  ["an overlong project", `?projectId=${"p".repeat(101)}`],
])("refuses %s", async (caseName, query) => {
  const response = await read(query);

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    ok: false,
    intent: "",
    error: "invalidInput",
  });
  expect(services.agentProfileService.catalog).not.toHaveBeenCalled();
});

it("refuses a visitor", async () => {
  const response = await loader(
    routeArguments(new Request("http://pages.invalid/x"), null, {}),
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: "accessDenied" });
});
