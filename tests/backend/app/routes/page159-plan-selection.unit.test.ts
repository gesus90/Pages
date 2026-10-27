import { beforeEach, expect, it, vi } from "vitest";

import { planSelectionCookie } from "@/app/lib/agent-plan-selection";
import { lastSelectedPlan } from "@/app/lib/agent-plan-selection.server";
import { loader } from "@/app/routes/agent-plans";
import { AgentError } from "@/backend/error/AgentErrors";

import { TICKET_ACTOR } from "../../backend/service/agents/page55-ticket-fixture";
import { routeArguments } from "../server-lib/route-arguments";

import type { AgentPlanView } from "@/definition/AgentPlan";

const service = vi.hoisted(() => ({
  visible: vi.fn(),
  page: vi.fn(),
  play: vi.fn(),
  resume: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({ agentPlanService: service }),
}));

function plan(id: string, name = id, workspaceId = "workspace"): AgentPlanView {
  return {
    id,
    name,
    workspaceId,
    projectId: "project",
    ownerId: "owner",
    usage: "private",
    globals: {},
    nodes: [],
    edges: [],
    revision: 1,
    canEdit: true,
    projectName: "Project",
    github: null,
  };
}

function serve(plans: readonly AgentPlanView[]): void {
  service.visible.mockResolvedValue(plans);
  service.page.mockImplementation(
    async (
      userId: string,
      selection: {
        readonly planId: string | null;
        readonly workspaceId: string | null;
      },
    ): Promise<unknown> => {
      const selected =
        selection.planId === null
          ? null
          : plans.find((entry) => entry.id === selection.planId);
      if (
        selected === undefined ||
        selection.workspaceId === "removed-workspace"
      )
        throw new AgentError("plan_access_denied");
      return { userId, selected, plans, runs: [], workspaces: [] };
    },
  );
}

async function remembered(
  planId: string,
  userId = "owner",
  origin = "http://pages.invalid",
): Promise<string> {
  return planSelectionCookie({ userId, origin }).serialize(planId);
}

async function open(
  options: {
    readonly search?: string;
    readonly cookie?: string;
    readonly userId?: string;
    readonly origin?: string;
    readonly path?: string;
  } = {},
): Promise<Awaited<ReturnType<typeof loader>>> {
  const request = new Request(
    `${options.origin ?? "http://pages.invalid"}${options.path ?? "/agents/plans"}${options.search ?? ""}`,
    {
      headers: { Cookie: options.cookie ?? "" },
    },
  );
  try {
    return await loader(
      routeArguments(
        request,
        { ...TICKET_ACTOR, id: options.userId ?? "owner" },
        {},
      ),
    );
  } catch (error: unknown) {
    if (!(error instanceof Response) || error.status !== 302) throw error;
    expect(error.headers.get("Set-Cookie")).toBeNull();
    const destination = error.headers.get("Location");
    if (!destination) throw new Error("Missing redirect destination");
    return open({ ...options, path: destination, search: "" });
  }
}

beforeEach(() => vi.resetAllMocks());

it("restores the stable ID after rename on document and router data requests without starting or saving", async () => {
  serve([plan("plus-local", "Renamed"), plan("default", "Task2")]);
  const cookie = await remembered("plus-local");
  for (const path of ["/agents/plans", "/agents/plans.data"]) {
    const result = await open({ cookie, path });
    expect(result.data.selected).toMatchObject({
      id: "plus-local",
      name: "Renamed",
    });
    expect(result.data.selectionPreference.planId).toBe("plus-local");
    expect(new Headers(result.init?.headers).get("Set-Cookie")).toBeNull();
  }
  expect(service.play).not.toHaveBeenCalled();
  expect(service.resume).not.toHaveBeenCalled();
  expect(service.save).not.toHaveBeenCalled();
});

it("prioritizes explicit links and dropdown URLs and remembers only a successful opening", async () => {
  serve([plan("last"), plan("chosen")]);
  const cookie = await remembered("last");
  const result = await open({ cookie, search: "?planId=chosen" });
  expect(result.data.selected?.id).toBe("chosen");
  expect(result.data.selectionPreference.planId).toBe("chosen");
  const missing = await open({ cookie, search: "?planId=missing" });
  expect(missing.data.selected).toBeNull();
  expect(missing.data.selectionPreference).toMatchObject({
    planId: null,
    discardedPlanId: null,
  });
});

it.each(["deleted", "hidden", "context-lost", "x".repeat(101)])(
  "discards an inaccessible remembered selection (%s) and leaves the regular empty editor",
  async (id) => {
    serve([plan("default", "Task2")]);
    const result = await open({ cookie: await remembered(id) });
    expect(result.data.selected).toBeNull();
    expect(result.data.opening).toBe("requestedMissing");
    expect(result.data.selectionPreference).toMatchObject({
      planId: null,
      discardedPlanId: id,
    });
    expect(service.page).toHaveBeenLastCalledWith("owner", {
      planId: null,
      workspaceId: null,
    });
  },
);

it("authorizes restoration again even when the plan was visible earlier", async () => {
  serve([plan("last")]);
  service.page.mockRejectedValueOnce(new AgentError("plan_access_denied"));
  const result = await open({ cookie: await remembered("last") });
  expect(result.data.selected).toBeNull();
  expect(result.data.selectionPreference.discardedPlanId).toBe("last");
});

it("discards a remembered plan with a removed workspace while keeping explicit repair links available", async () => {
  serve([{ ...plan("last"), isWorkspaceMissing: true }]);
  const cookie = await remembered("last");
  const result = await open({ cookie });
  expect(result.data.selected).toBeNull();
  expect(result.data.selectionPreference.discardedPlanId).toBe("last");
  const explicit = await open({ cookie, search: "?planId=last" });
  expect(explicit.data.selected?.id).toBe("last");
});

it("isolates accounts and instances, including two ports of the same host", async () => {
  serve([plan("last"), plan("default", "Task2")]);
  const cookie = await remembered("last");
  for (const options of [
    { userId: "other" },
    { origin: "http://elsewhere.invalid" },
    { origin: "http://pages.invalid:3100" },
  ]) {
    const result = await open({ cookie, ...options });
    expect(result.data.selected?.id).toBe("default");
  }
  expect((await open({ cookie })).data.selected?.id).toBe("last");
});

it("respects explicit workspace context instead of reopening a plan from another workspace", async () => {
  serve([plan("last"), plan("default", "Task2")]);
  const cookie = await remembered("last");
  for (const search of [
    "?workspaceId=other",
    "?workspaceId=other&planId=last",
    "?workspaceId=removed-workspace",
  ]) {
    const result = await open({ cookie, search });
    expect(result.data.selected).toBeNull();
    expect(result.data.selectionPreference.discardedPlanId).toBeNull();
    expect(result.data.catalogRefresh?.url).toBe(
      "/agent-api/plan-sources?refresh=1",
    );
  }
  expect(service.page).toHaveBeenLastCalledWith("owner", {
    planId: null,
    workspaceId: null,
  });
});

it("accepts the default only in the requested workspace and ignores malformed preferences", async () => {
  serve([plan("default", "Task2")]);
  expect(
    (await open({ search: "?workspaceId=workspace" })).data.selected?.id,
  ).toBe("default");
  const cookie = planSelectionCookie({
    userId: "owner",
    origin: "http://pages.invalid",
  });
  for (const selection of [{ planId: "last" }, null, 42, "", "x".repeat(201)]) {
    const request = new Request("http://pages.invalid/agents/plans.data", {
      headers: { Cookie: await cookie.serialize(selection) },
    });
    expect(await lastSelectedPlan(request, "owner")).toBeNull();
  }
  expect(
    await lastSelectedPlan(
      new Request("http://pages.invalid/agents/plans", {
        headers: { Cookie: `${cookie.name}=broken` },
      }),
      "owner",
    ),
  ).toBeNull();
});
