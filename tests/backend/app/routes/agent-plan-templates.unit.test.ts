import { beforeEach, expect, it, vi } from "vitest";

import { readPlanTemplateNode } from "@/backend/agents/AgentPlanTemplateInput";
import { action, loader } from "@/app/routes/agent-plan-templates";
import { AgentError } from "@/backend/error/AgentErrors";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { AgentPlanParameter } from "@/definition/AgentPlan";
import type { User } from "@/definition/User";

const services = vi.hoisted(() => ({
  agentPlanTemplateService: { insert: vi.fn(), list: vi.fn(), save: vi.fn() },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));
vi.mock(
  import("@/backend/agents/AgentPlanTemplateInput"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    readPlanTemplateNode: vi.fn(),
  }),
);

const templates = services.agentPlanTemplateService;
const NODE: AgentPlanParameter = {
  id: "node-1",
  type: "parameter",
  name: "topic",
  format: "string",
  value: { type: "text", text: "Tests" },
  x: 0,
  y: 0,
};

beforeEach(() => {
  vi.resetAllMocks();
});

async function list(
  query: string,
  user: User | null = EMPLOYEE,
): Promise<Response> {
  return loader(
    routeArguments(
      new Request(`http://pages.invalid/agent-api/plan-templates${query}`),
      user,
      {},
    ),
  );
}

async function post(
  fields: Readonly<Record<string, string>>,
): Promise<Response> {
  return action(
    routeArguments(
      new Request("http://pages.invalid/agent-api/plan-templates", {
        body: new URLSearchParams(fields),
        method: "POST",
      }),
      EMPLOYEE,
      {},
    ),
  );
}

it("lists the templates for the workspace of the open plan", async () => {
  templates.list.mockResolvedValue([{ id: "t1" }]);

  const response = await list("?workspaceId=w1");

  expect(templates.list).toHaveBeenCalledWith(EMPLOYEE.id, "w1");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ templates: [{ id: "t1" }] });
});

it("lists only the personal templates without a workspace", async () => {
  templates.list.mockResolvedValue([]);

  await list("?workspaceId=");

  expect(templates.list).toHaveBeenCalledWith(EMPLOYEE.id, null);
});

it("refuses a visitor the list", async () => {
  const response = await list("", null);

  expect(response.status).toBe(403);
  expect(templates.list).not.toHaveBeenCalled();
});

it("saves a node of a saved plan as a template", async () => {
  vi.mocked(readPlanTemplateNode).mockReturnValue(NODE);
  templates.save.mockResolvedValue({ id: "t1" });

  const response = await post({
    intent: "save-template",
    planId: "plan-1",
    workspaceId: "w1",
    name: " Review ",
    node: '{"id":"node-1"}',
  });

  expect(readPlanTemplateNode).toHaveBeenCalledWith('{"id":"node-1"}');
  expect(templates.save).toHaveBeenCalledWith(
    EMPLOYEE.id,
    { planId: "plan-1", workspaceId: "w1" },
    { name: "Review", node: NODE },
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    ok: true,
    intent: "save-template",
    template: { id: "t1" },
  });
});

it("inserts a checked copy into the draft of an unsaved plan", async () => {
  templates.insert.mockResolvedValue(NODE);

  const response = await post({
    intent: "insert-template",
    workspaceId: "w1",
    templateId: "t1",
  });

  expect(templates.insert).toHaveBeenCalledWith(
    EMPLOYEE.id,
    { planId: null, workspaceId: "w1" },
    "t1",
  );
  expect(await response.json()).toEqual({
    ok: true,
    intent: "insert-template",
    node: NODE,
  });
});

it("reports a node that is no JSON as an invalid template", async () => {
  vi.mocked(readPlanTemplateNode).mockImplementation(() => {
    throw new SyntaxError("Unexpected token");
  });

  const response = await post({
    intent: "save-template",
    workspaceId: "w1",
    name: "Review",
    node: "{",
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    ok: false,
    intent: "save-template",
    error: "template_invalid",
  });
  expect(templates.save).not.toHaveBeenCalled();
});

it("reports a refusal of the template service", async () => {
  templates.insert.mockRejectedValue(new AgentError("template_not_found"));

  const response = await post({
    intent: "insert-template",
    workspaceId: "w1",
    templateId: "t1",
  });

  expect(response.status).toBe(404);
});

it.each<Readonly<Record<string, string>>>([{}, { intent: "delete-template" }])(
  "refuses the submission %j",
  async (fields) => {
    const response = await post(fields);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "plan_invalid" });
  },
);
