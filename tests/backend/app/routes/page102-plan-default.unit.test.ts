import { beforeEach, expect, it, vi } from "vitest";

import { defaultPlanId, DEFAULT_PLAN_NAME } from "@/app/lib/agent-plan-default";
import { loader } from "@/app/routes/agent-plans";
import { AgentError } from "@/backend/error/AgentErrors";

import { TICKET_ACTOR } from "../../backend/service/agents/page55-ticket-fixture";
import { thrownStatus } from "../actions/action-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { AgentPlanView } from "@/definition/AgentPlan";

const service = vi.hoisted(() => ({ visible: vi.fn(), page: vi.fn() }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({ agentPlanService: service }),
}));

/** A readable plan as the access service lists it; only identity, name and owner matter here. */
function plan(id: string, name: string, ownerId = "owner"): AgentPlanView {
  return {
    id,
    name,
    ownerId,
    projectId: "project",
    workspaceId: "workspace",
    usage: "private",
    globals: {},
    nodes: [],
    edges: [],
    revision: 1,
    canEdit: ownerId === "owner",
    projectName: "Project",
    github: null,
  };
}

/** The readable plans of the synthetic person; every other identifier is missing or hidden. */
function serve(plans: readonly AgentPlanView[]): void {
  service.visible.mockResolvedValue(plans);
  service.page.mockImplementation(
    async (
      userId: string,
      selection: { readonly planId: string | null },
    ): Promise<unknown> => {
      const selected =
        selection.planId === null
          ? null
          : plans.find((entry) => entry.id === selection.planId);
      if (selected === undefined) throw new AgentError("plan_access_denied");
      return { userId, plans, selected, runs: [] };
    },
  );
}

async function open(search = ""): Promise<{
  readonly opening: string;
  readonly selected: { readonly id: string } | null;
}> {
  const request = new Request(`http://pages.invalid/agents/plans${search}`);
  const result = await loader(routeArguments(request, TICKET_ACTOR, {}));
  return result.data;
}

beforeEach(() => {
  vi.resetAllMocks();
});

it("opens the readable plan named Task2 when the address names no plan", async () => {
  serve([plan("alpha", "Alpha"), plan("task-two", "Task2")]);
  const page = await open();
  expect(page.opening).toBe("default");
  expect(page.selected?.id).toBe("task-two");
  expect(service.visible).toHaveBeenCalledExactlyOnceWith("owner");
  expect(service.page).toHaveBeenCalledExactlyOnceWith("owner", {
    planId: "task-two",
    workspaceId: null,
  });
});

it("lets a plan identifier in the address take precedence over Task2", async () => {
  serve([plan("alpha", "Alpha"), plan("task-two", "Task2")]);
  const page = await open("?planId=alpha");
  expect(page.opening).toBe("requested");
  expect(page.selected?.id).toBe("alpha");
  expect(service.visible).not.toHaveBeenCalled();
});

it("leaves the canvas empty for a missing or hidden plan instead of opening Task2", async () => {
  serve([plan("task-two", "Task2")]);
  const page = await open("?planId=someone-elses");
  expect(page.opening).toBe("requestedMissing");
  expect(page.selected).toBeNull();
  expect(service.page).toHaveBeenLastCalledWith("owner", {
    planId: null,
    workspaceId: null,
  });
  expect(service.visible).not.toHaveBeenCalled();
});

it("treats a malformed plan identifier like a missing plan without looking it up", async () => {
  serve([plan("task-two", "Task2")]);
  const page = await open(`?planId=${"x".repeat(101)}`);
  expect(page.opening).toBe("requestedMissing");
  expect(page.selected).toBeNull();
  expect(service.page).toHaveBeenCalledExactlyOnceWith("owner", {
    planId: null,
    workspaceId: null,
  });
});

it("opens no other plan when no readable plan is called Task2", async () => {
  serve([plan("alpha", "Alpha"), plan("task", "Task 2"), plan("t", "task2")]);
  const page = await open();
  expect(page.opening).toBe("defaultMissing");
  expect(page.selected).toBeNull();
  expect(service.page).toHaveBeenCalledExactlyOnceWith("owner", {
    planId: null,
    workspaceId: null,
  });
});

it("shows an empty canvas when Task2 disappears between listing and opening", async () => {
  serve([plan("task-two", "Task2")]);
  service.page.mockRejectedValueOnce(new AgentError("plan_access_denied"));
  const page = await open();
  expect(page.opening).toBe("defaultMissing");
  expect(page.selected).toBeNull();
});

it("still answers other failures with the safe error response", async () => {
  serve([plan("task-two", "Task2")]);
  service.page.mockRejectedValue(new AgentError("plan_running"));
  expect(await thrownStatus(open())).toBe(409);
  service.page.mockReset();
  expect(await thrownStatus(open("?workspaceId="))).toBe(400);
  expect(service.page).not.toHaveBeenCalled();
});

it("prefers the person's own Task2 and otherwise takes a readable shared one", () => {
  const shared = plan("shared", "Task2", "colleague");
  const own = plan("own", " Task2 ", "owner");
  expect(DEFAULT_PLAN_NAME).toBe("Task2");
  expect(defaultPlanId([shared, own], "owner")).toBe("own");
  expect(defaultPlanId([shared], "owner")).toBe("shared");
  expect(defaultPlanId([plan("other", "Task3")], "owner")).toBeNull();
  expect(defaultPlanId([], "owner")).toBeNull();
});
