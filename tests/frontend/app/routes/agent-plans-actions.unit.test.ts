import { RouterContextProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import {
  clonePlanAction,
  createPlanAction,
  deletePlanAction,
} from "@/app/lib/agent-plan-management.server";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { action } from "@/app/routes/agent-plans";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { User } from "@/definition/User";

const service = vi.hoisted(() => ({
  save: vi.fn(),
  view: vi.fn(),
  play: vi.fn(),
  saveAndPlay: vi.fn(),
  stop: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
}));
vi.mock("@/app/lib/auth.server", async () => {
  const router = await import("react-router");
  return { authenticatedUserContext: router.createContext<User | null>(null) };
});
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => ({
    agentPlanService: service,
  }),
}));
vi.mock("@/app/lib/agent-plan-management.server", () => ({
  createPlanAction: vi.fn(),
  clonePlanAction: vi.fn(),
  deletePlanAction: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const USER: User = {
  id: "user-1",
  username: "ada",
  displayName: "Ada",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const PLAN = {
  name: "Plan",
  usage: "private",
  workspaceId: "workspace",
  nodes: [],
  edges: [],
  globals: {},
};
const RUN = { id: "run-1", planRevision: 4, steps: [] };
const INVALID = { status: 400, body: { ok: false, error: "plan_invalid" } };

beforeEach(() => {
  for (const method of Object.values(service)) method.mockReset();
  vi.mocked(logCaughtError).mockReset();
});

/** Sends a request to the action as the signed-in user. */
async function send(request: Request): Promise<Response> {
  const context = new RouterContextProvider();
  context.set(authenticatedUserContext, USER);
  return action({
    request,
    context,
    params: {},
    url: new URL(request.url),
    pattern: "/agents/plans",
  });
}

/** Posts a form with the given fields and reads the JSON answer. */
async function post(
  fields: Readonly<Record<string, string>>,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const response = await send(
    new Request("http://pages.invalid/agents/plans", {
      method: "POST",
      body: new URLSearchParams(fields),
    }),
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  return { status: response.status, body: await response.json() };
}

it("refuses anything but a form post", async () => {
  const response = await send(new Request("http://pages.invalid/agents/plans"));

  expect(response.status).toBe(405);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

it("saves a new plan as its first revision", async () => {
  service.save.mockResolvedValue("plan-new");

  await expect(
    post({ intent: "save-plan", plan: JSON.stringify(PLAN) }),
  ).resolves.toEqual({
    status: 200,
    body: { ok: true, intent: "save-plan", planId: "plan-new", revision: 1 },
  });
  expect(service.save).toHaveBeenCalledWith(
    "user-1",
    null,
    expect.objectContaining({ name: "Plan", usage: "private" }),
  );
});

it("saves an existing plan as the revision after the one it was based on", async () => {
  service.save.mockResolvedValue("plan-1");

  await expect(
    post({
      intent: "save-plan",
      planId: "plan-1",
      plan: JSON.stringify({ ...PLAN, revision: 3 }),
    }),
  ).resolves.toMatchObject({ body: { planId: "plan-1", revision: 4 } });
  await expect(
    post({ intent: "save-plan", planId: "plan-1", plan: JSON.stringify(PLAN) }),
  ).resolves.toMatchObject({ body: { revision: 1 } });
});

it("answers a conflicting save with the current revision", async () => {
  service.save.mockRejectedValue(new AgentError("plan_conflict"));
  service.view.mockResolvedValue({ revision: 9 });

  await expect(
    post({ intent: "save-plan", planId: "plan-1", plan: JSON.stringify(PLAN) }),
  ).resolves.toEqual({
    status: 409,
    body: {
      ok: false,
      intent: "save-plan",
      error: "plan_conflict",
      currentRevision: 9,
    },
  });
  expect(service.view).toHaveBeenCalledWith("user-1", "plan-1");
});

it("passes other save failures and conflicts of a new plan on", async () => {
  service.save.mockRejectedValueOnce(new AgentError("plan_conflict"));
  await expect(
    post({ intent: "save-plan", plan: JSON.stringify(PLAN) }),
  ).resolves.toEqual({
    status: 409,
    body: { ok: false, intent: "save-plan", error: "plan_conflict" },
  });

  service.save.mockRejectedValueOnce(new AgentError("plan_name_taken"));
  await expect(
    post({ intent: "save-plan", planId: "plan-1", plan: JSON.stringify(PLAN) }),
  ).resolves.toMatchObject({ status: 409, body: { error: "plan_name_taken" } });

  service.save.mockRejectedValueOnce(new Error("disk full"));
  await expect(
    post({ intent: "save-plan", planId: "plan-1", plan: JSON.stringify(PLAN) }),
  ).resolves.toMatchObject({ status: 500, body: { error: "general" } });
  expect(service.view).not.toHaveBeenCalled();
});

it("refuses a malformed identifier, an oversized or unreadable plan before saving", async () => {
  await expect(
    post({
      intent: "save-plan",
      planId: "a\u0001",
      plan: JSON.stringify(PLAN),
    }),
  ).resolves.toMatchObject(INVALID);
  await expect(
    post({ intent: "save-plan", plan: "x".repeat(2_000_001) }),
  ).resolves.toMatchObject(INVALID);
  await expect(
    post({ intent: "save-plan", plan: "{not json" }),
  ).resolves.toMatchObject(INVALID);
  await expect(post({ intent: "save-plan" })).resolves.toMatchObject(INVALID);
  expect(service.save).not.toHaveBeenCalled();
});

it("hands creating, cloning and deleting to the plan management", async () => {
  const headers = { "Cache-Control": "no-store" };
  vi.mocked(createPlanAction).mockResolvedValue(
    Response.json({ created: 1 }, { headers }),
  );
  vi.mocked(clonePlanAction).mockResolvedValue(
    Response.json({ cloned: 1 }, { headers }),
  );
  vi.mocked(deletePlanAction).mockResolvedValue(
    new Response(null, { status: 302, headers }),
  );

  await expect(post({ intent: "create-plan", name: "A" })).resolves.toEqual({
    status: 200,
    body: { created: 1 },
  });
  await expect(post({ intent: "clone-plan" })).resolves.toMatchObject({
    body: { cloned: 1 },
  });
  const deletion = await send(
    new Request("http://pages.invalid/agents/plans", {
      method: "POST",
      body: new URLSearchParams({ intent: "delete-plan", planId: "plan-1" }),
    }),
  );

  expect(deletion.status).toBe(302);
  const [created] = vi.mocked(createPlanAction).mock.calls;
  expect(created?.[0]).toBe("user-1");
  expect(created?.[2].get("name")).toBe("A");
  const [deleted] = vi.mocked(deletePlanAction).mock.calls;
  expect(deleted?.[2].formData.get("planId")).toBe("plan-1");
  expect(deleted?.[2].request.method).toBe("POST");
});

it("starts the saved revision a play names", async () => {
  service.play.mockResolvedValue(RUN);

  await expect(
    post({ intent: "play-plan", planId: "plan-1", revision: "4" }),
  ).resolves.toEqual({
    status: 200,
    body: {
      ok: true,
      intent: "play-plan",
      planId: "plan-1",
      revision: 4,
      run: RUN,
    },
  });
  expect(service.play).toHaveBeenCalledWith("user-1", "plan-1", 4);
});

it("saves and starts the changes of an earlier client", async () => {
  service.saveAndPlay.mockResolvedValue(RUN);

  await expect(
    post({ intent: "play-plan", planId: "plan-1", plan: JSON.stringify(PLAN) }),
  ).resolves.toMatchObject({ status: 200, body: { revision: 4 } });
  expect(service.saveAndPlay).toHaveBeenCalledWith(
    "user-1",
    "plan-1",
    expect.objectContaining({ name: "Plan" }),
  );
});

it("refuses a play without a valid revision", async () => {
  for (const revision of ["0", "2.5", ""])
    await expect(
      post({ intent: "play-plan", planId: "plan-1", revision }),
    ).resolves.toMatchObject(INVALID);
  expect(service.play).not.toHaveBeenCalled();
});

it("stops, pauses and resumes a run", async () => {
  service.stop.mockResolvedValue({ id: "run-1", state: "stopped", steps: [] });
  service.pause.mockResolvedValue({ id: "run-1", state: "paused", steps: [] });
  service.resume.mockResolvedValue({
    id: "run-1",
    state: "running",
    steps: [],
  });

  await expect(post({ intent: "stop-plan", runId: "run-1" })).resolves.toEqual({
    status: 200,
    body: {
      ok: true,
      intent: "stop-plan",
      run: { id: "run-1", state: "stopped", steps: [] },
    },
  });
  await expect(
    post({ intent: "pause-plan", runId: "run-1" }),
  ).resolves.toMatchObject({ body: { run: { state: "paused" } } });
  await expect(
    post({ intent: "resume-plan", runId: "run-1", revision: "5" }),
  ).resolves.toMatchObject({ body: { run: { state: "running" } } });

  expect(service.stop).toHaveBeenCalledWith("user-1", "run-1");
  expect(service.pause).toHaveBeenCalledWith("user-1", "run-1");
  expect(service.resume).toHaveBeenCalledWith("user-1", "run-1", 5);
});

it("refuses a missing or unknown intent", async () => {
  await expect(post({})).resolves.toEqual({
    status: 400,
    body: { ok: false, intent: "", error: "plan_invalid" },
  });
  await expect(post({ intent: "rename-plan" })).resolves.toMatchObject({
    status: 400,
    body: { intent: "rename-plan", error: "plan_invalid" },
  });
  expect(logCaughtError).toHaveBeenCalledWith(
    "agent_plans",
    expect.any(AgentError),
  );
});
