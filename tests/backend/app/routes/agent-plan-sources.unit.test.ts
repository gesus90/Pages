import { beforeEach, expect, it, vi } from "vitest";

import { loader } from "@/app/routes/agent-plan-sources";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { User } from "@/definition/User";

const services = vi.hoisted(() => ({
  agentPlanService: { agents: vi.fn(), context: vi.fn(), sources: vi.fn() },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

const plans = services.agentPlanService;

const PAGE = {
  userId: EMPLOYEE.id,
  teamDepartmentId: null,
  plans: [],
  workspaces: [{ id: "w1" }],
  remoteWorkspaces: [],
  selected: null,
  sources: [],
  directory: null,
};

const AGENT = {
  id: "agent-1",
  name: "Reviewer",
  revision: 4,
  model: "model-1",
  provider: "codex",
  reasoningEffort: "high",
  modelProfileId: "profile-1",
  availability: { isUsable: true, personalChoices: [] },
  configuration: {
    accessMode: "shared",
    markdown: "# Review",
    parameters: [],
    directoryParameter: null,
  },
};

beforeEach(() => {
  vi.resetAllMocks();
});

async function read(
  query: string,
  headers: Readonly<Record<string, string>> = {},
  user: User | null = EMPLOYEE,
): Promise<Response> {
  return loader(
    routeArguments(
      new Request(`http://pages.invalid/agent-api/plan-sources${query}`, {
        headers,
      }),
      user,
      {},
    ),
  );
}

it("lists the sources of an authorized workspace", async () => {
  plans.sources.mockResolvedValue([{ id: "s1" }]);

  const response = await read("?workspaceId=w1");

  expect(plans.sources).toHaveBeenCalledWith(EMPLOYEE.id, "w1");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    workspaceId: "w1",
    sources: [{ id: "s1" }],
  });
});

it("copies the runtime configuration of a usable source", async () => {
  plans.agents.mockResolvedValue([{ ...AGENT, id: "other" }, AGENT]);

  const response = await read("?workspaceId=w1&agentId=agent-1");

  expect(plans.agents).toHaveBeenCalledWith(EMPLOYEE.id, "w1");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    name: "Reviewer",
    revision: 4,
    modelProfileId: "profile-1",
    model: "model-1",
    provider: "codex",
    reasoningEffort: "high",
    template: {
      markdown: "# Review",
      parameters: [],
      directoryParameter: null,
    },
  });
});

it.each([
  ["a missing source", []],
  [
    "an unusable source",
    [{ ...AGENT, availability: { isUsable: false, personalChoices: [] } }],
  ],
])("refuses %s", async (caseName, agents) => {
  plans.agents.mockResolvedValue(agents);

  const response = await read("?workspaceId=w1&agentId=agent-1");

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: "agent_usage_denied" });
});

it("tells a refresh what changed in the page of a plan", async () => {
  plans.context.mockResolvedValue(PAGE);

  const response = await read("?refresh=1&planId=plan-1&workspaceId=w1");

  expect(plans.context).toHaveBeenCalledWith(EMPLOYEE.id, {
    planId: "plan-1",
    workspaceId: "w1",
  });
  expect(response.headers.get("ETag")).toMatch(/^W\/"/u);
  expect(await response.json()).toEqual({ changed: true });
});

it("answers an unchanged page of no plan with 304", async () => {
  plans.context.mockResolvedValue(PAGE);
  const first = await read("?refresh=1");

  const second = await read("?refresh=1", {
    "If-None-Match": first.headers.get("ETag") ?? "",
  });

  expect(plans.context).toHaveBeenCalledWith(EMPLOYEE.id, {
    planId: null,
    workspaceId: null,
  });
  expect(second.status).toBe(304);
});

it("refuses a request without workspace", async () => {
  const response = await read("");

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: "plan_invalid" });
  expect(plans.sources).not.toHaveBeenCalled();
});

it("refuses a visitor", async () => {
  const response = await read("?workspaceId=w1", {}, null);

  expect(response.status).toBe(403);
  expect(plans.sources).not.toHaveBeenCalled();
});
