import { beforeEach, expect, it, vi } from "vitest";

import {
  fetchPlanTemplates,
  insertPlanTemplate,
  savePlanTemplate,
} from "@/app/components/agents/plans/plan-templates/plan-template-requests";

import {
  jsonResponse,
  parameterNode,
  postedFields,
  savedTemplate,
  stubFetch,
} from "./template-fixture";

const TARGET = { planId: "plan", workspaceId: "workspace" };

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

it("lists the templates of a workspace without caching", async () => {
  const template = savedTemplate();
  const fetchMock = stubFetch(jsonResponse({ templates: [template] }));
  await expect(fetchPlanTemplates("workspace 1")).resolves.toEqual([template]);
  expect(fetchMock).toHaveBeenCalledWith(
    "/agent-api/plan-templates?workspaceId=workspace+1",
    { cache: "no-store" },
  );
});

it("lists personal templates without a workspace query", async () => {
  const fetchMock = stubFetch(jsonResponse({ templates: [] }));
  await expect(fetchPlanTemplates("")).resolves.toEqual([]);
  expect(fetchMock.mock.calls[0]?.[0]).toBe("/agent-api/plan-templates");
});

it("refuses a failed or malformed template list", async () => {
  stubFetch(
    jsonResponse({ error: "forbidden" }, 403),
    jsonResponse({ templates: "none" }),
    jsonResponse(null),
    jsonResponse(["template"]),
  );
  await expect(fetchPlanTemplates("w")).rejects.toThrow(
    "Node templates unavailable",
  );
  await expect(fetchPlanTemplates("w")).rejects.toThrow(
    "Node templates malformed",
  );
  await expect(fetchPlanTemplates("w")).rejects.toThrow(
    "Node templates malformed",
  );
  await expect(fetchPlanTemplates("w")).rejects.toThrow(
    "Node templates malformed",
  );
});

it("saves a named node as a form post and returns the stored template", async () => {
  const template = savedTemplate();
  const fetchMock = stubFetch(jsonResponse({ template }));
  const result = await savePlanTemplate(TARGET, {
    name: "Topic",
    node: parameterNode(),
  });
  expect(result).toEqual({ ok: true, value: template });
  expect(fetchMock.mock.calls[0]?.[0]).toBe("/agent-api/plan-templates");
  expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
    method: "POST",
    cache: "no-store",
  });
  expect(postedFields(fetchMock)).toEqual({
    planId: "plan",
    workspaceId: "workspace",
    intent: "save-template",
    name: "Topic",
    node: JSON.stringify(parameterNode()),
  });
});

it("passes the stable code of a refused save and falls back to general", async () => {
  stubFetch(
    jsonResponse({ error: "template_name_taken" }, 409),
    jsonResponse({ error: 7 }, 400),
    jsonResponse(null, 400),
    jsonResponse("refused", 400),
    new Response("not json", { status: 500 }),
  );
  const draft = { name: "Topic", node: parameterNode() };
  await expect(savePlanTemplate(TARGET, draft)).resolves.toEqual({
    ok: false,
    error: "template_name_taken",
  });
  for (let index = 0; index < 4; index += 1)
    await expect(savePlanTemplate(TARGET, draft)).resolves.toEqual({
      ok: false,
      error: "general",
    });
  expect(console.warn).toHaveBeenCalledOnce();
});

it("reports an unreadable or unreachable save as a general failure", async () => {
  stubFetch(jsonResponse({}), jsonResponse(null), new Error("offline"));
  const draft = { name: "Topic", node: parameterNode() };
  for (let index = 0; index < 3; index += 1)
    await expect(savePlanTemplate(TARGET, draft)).resolves.toEqual({
      ok: false,
      error: "general",
    });
  expect(console.error).toHaveBeenCalledTimes(3);
});

it("inserts a checked copy of a template node", async () => {
  const node = parameterNode({ id: "copy" });
  const fetchMock = stubFetch(jsonResponse({ node }));
  await expect(insertPlanTemplate(TARGET, "template")).resolves.toEqual({
    ok: true,
    value: node,
  });
  expect(postedFields(fetchMock)).toEqual({
    planId: "plan",
    workspaceId: "workspace",
    intent: "insert-template",
    templateId: "template",
  });
});

it("refuses an insertion the server declined or answered without a template node", async () => {
  stubFetch(
    jsonResponse({ error: "template_missing" }, 404),
    jsonResponse({ node: { id: "start", type: "start", x: 0, y: 0 } }),
    jsonResponse({}),
    jsonResponse(null),
    new Error("offline"),
  );
  await expect(insertPlanTemplate(TARGET, "template")).resolves.toEqual({
    ok: false,
    error: "template_missing",
  });
  for (let index = 0; index < 4; index += 1)
    await expect(insertPlanTemplate(TARGET, "template")).resolves.toEqual({
      ok: false,
      error: "general",
    });
  expect(console.error).toHaveBeenCalledTimes(3);
});
