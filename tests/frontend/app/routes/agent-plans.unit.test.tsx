import { render, screen } from "@testing-library/react";
import {
  createMemoryRouter,
  RouterContextProvider,
  RouterProvider,
} from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { usePlanSelectionPreference } from "@/app/components/agents/plans/use-plan-selection-preference";
import { planCatalogRefresh } from "@/app/lib/agent-plan-catalog.server";
import { lastSelectedPlan } from "@/app/lib/agent-plan-selection.server";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import AgentPlansRoute, { headers, loader } from "@/app/routes/agent-plans";
import { readPlanText } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";

import type * as AgentPlanInput from "@/backend/agents/AgentPlanInput";
import type { User } from "@/definition/User";

/** A plan of the synthetic catalog; only identity, name and workspace matter. */
interface CatalogPlan {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly workspaceId: string;
  readonly isWorkspaceMissing?: boolean;
}

/** The selection the loader asks the plan service for. */
interface PageSelection {
  readonly planId: string | null;
  readonly workspaceId: string | null;
}

const service = vi.hoisted(() => ({
  summaries: vi.fn<(userId: string) => Promise<readonly CatalogPlan[]>>(),
  page: vi.fn<(userId: string, selection: PageSelection) => Promise<unknown>>(),
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
vi.mock("@/app/lib/agent-plan-selection.server", () => ({
  lastSelectedPlan: vi.fn(),
}));
vi.mock("@/app/lib/agent-plan-catalog.server", () => ({
  planCatalogRefresh: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));
vi.mock(
  "@/backend/agents/AgentPlanInput",
  async (importOriginal: () => Promise<typeof AgentPlanInput>) => {
    const original = await importOriginal();
    return { ...original, readPlanText: vi.fn(original.readPlanText) };
  },
);
vi.mock("@/app/components/agents/plans/use-plan-selection-preference", () => ({
  usePlanSelectionPreference: vi.fn(),
}));
vi.mock("@/app/components/agents/plans/plan-retired-notice", () => ({
  PlanRetiredNotice: (): React.ReactElement => <aside>Retired</aside>,
}));
vi.mock("@/app/components/agents/plans/plan-page", () => ({
  PlanPage: (props: {
    readonly page: { readonly selected: { readonly id: string } | null };
    readonly opening: string;
    readonly catalogRefresh: { readonly url: string } | undefined;
  }): React.ReactElement => (
    <main>
      {`${props.page.selected?.id ?? "none"} ${props.opening} ${props.catalogRefresh?.url ?? ""}`}
    </main>
  ),
}));

const USER: User = {
  id: "user-1",
  username: "ada",
  displayName: "Ada",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const REFRESH = { url: "/agent-api/plan-sources?refresh=1", etag: "tag" };

/** A plan owned by the person in the given workspace. */
function plan(
  id: string,
  name = id,
  options: Partial<Omit<CatalogPlan, "id" | "name">> = {},
): CatalogPlan {
  return { id, name, ownerId: "user-1", workspaceId: "workspace", ...options };
}

/** Serves a catalog in which every listed plan is readable and nothing else. */
function serve(plans: readonly CatalogPlan[]): void {
  service.summaries.mockResolvedValue(plans);
  service.page.mockImplementation(async (userId, selection) => {
    const selected =
      selection.planId === null
        ? null
        : plans.find((entry) => entry.id === selection.planId);
    if (selected === undefined) throw new AgentError("plan_access_denied");
    return { userId, selected, plans, runs: [], workspaces: [] };
  });
}

beforeEach(() => {
  service.summaries.mockReset();
  service.page.mockReset();
  vi.mocked(lastSelectedPlan).mockReset().mockResolvedValue(null);
  vi.mocked(planCatalogRefresh).mockReset().mockReturnValue(REFRESH);
});

/** Runs the loader for an address of the plan editor. */
async function load(
  search: string,
  user: User | null = USER,
): Promise<Awaited<ReturnType<typeof loader>>> {
  const request = new Request(`http://pages.invalid/agents/plans${search}`);
  const context = new RouterContextProvider();
  context.set(authenticatedUserContext, user);
  return loader({
    request,
    context,
    params: {},
    url: new URL(request.url),
    pattern: "/agents/plans",
  });
}

/** Runs the loader and returns the response it threw. */
async function thrown(
  search: string,
  user: User | null = USER,
): Promise<Response> {
  try {
    await load(search, user);
  } catch (error: unknown) {
    if (error instanceof Response) return error;
    throw error;
  }
  throw new Error("Expected a thrown response.");
}

it("keeps graphs and results out of every cache", () => {
  const result = new Headers(
    headers({
      parentHeaders: new Headers({ "X-Parent": "1" }),
      loaderHeaders: new Headers(),
      actionHeaders: new Headers(),
      errorHeaders: undefined,
    }),
  );

  expect(result.get("Cache-Control")).toBe("no-store");
  expect(result.get("X-Parent")).toBe("1");
});

it("refuses a visitor without a signed-in user", async () => {
  const response = await thrown("", null);

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: "plan_access_denied" });
});

it("pins the default plan in the address when the address names none", async () => {
  serve([plan("other", "Other"), plan("task-two", "Task2")]);

  const response = await thrown("");

  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe(
    "/agents/plans?planId=task-two",
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

it("pins a remembered plan in the address", async () => {
  serve([plan("kept", "Kept")]);
  vi.mocked(lastSelectedPlan).mockResolvedValue("kept");

  const response = await thrown("");

  expect(response.headers.get("Location")).toBe("/agents/plans?planId=kept");
  expect(service.summaries).not.toHaveBeenCalled();
});

it("opens a requested plan and remembers it without discarding another choice", async () => {
  serve([plan("alpha"), plan("beta")]);
  vi.mocked(lastSelectedPlan).mockResolvedValue("beta");

  const result = await load("?planId=alpha");

  expect(result.data).toMatchObject({
    opening: "requested",
    selected: { id: "alpha" },
    catalogRefresh: REFRESH,
    selectionPreference: {
      userId: "user-1",
      origin: "http://pages.invalid",
      planId: "alpha",
      discardedPlanId: null,
    },
  });
  expect(new Headers(result.init?.headers).get("Cache-Control")).toBe(
    "no-store",
  );
  expect(planCatalogRefresh).toHaveBeenCalledWith(
    expect.objectContaining({ userId: "user-1" }),
    null,
  );
});

it("marks the remembered plan as discarded when the same plan is requested", async () => {
  serve([plan("alpha")]);
  vi.mocked(lastSelectedPlan).mockResolvedValue("alpha");

  const result = await load("?planId=alpha");

  expect(result.data.selectionPreference.discardedPlanId).toBe("alpha");
});

it("leaves the canvas empty instead of restoring a plan whose workspace is gone", async () => {
  serve([plan("stale", "Stale", { isWorkspaceMissing: true })]);
  vi.mocked(lastSelectedPlan).mockResolvedValue("stale");

  const result = await load("");

  expect(result.data).toMatchObject({
    opening: "requestedMissing",
    selected: null,
    selectionPreference: { planId: null, discardedPlanId: "stale" },
  });
});

it("opens a requested plan whose workspace is gone, as a repair link", async () => {
  serve([plan("stale", "Stale", { isWorkspaceMissing: true })]);

  const result = await load("?planId=stale");

  expect(result.data).toMatchObject({
    opening: "requested",
    selected: { id: "stale" },
  });
});

it("opens the default plan of a requested workspace without pinning it", async () => {
  serve([
    plan("elsewhere", "Task2", { workspaceId: "other" }),
    plan("here", "Task2", { workspaceId: "workspace" }),
  ]);

  const result = await load("?workspaceId=workspace");

  expect(result.data).toMatchObject({
    opening: "default",
    selected: { id: "here" },
    selectionPreference: { planId: "here", discardedPlanId: null },
  });
  expect(planCatalogRefresh).toHaveBeenCalledWith(
    expect.anything(),
    "workspace",
  );
});

it("does not open a plan of another workspace than the requested one", async () => {
  serve([plan("alpha", "Alpha", { workspaceId: "other" })]);

  const result = await load("?planId=alpha&workspaceId=workspace");

  expect(result.data).toMatchObject({
    opening: "requestedMissing",
    selected: null,
  });
  expect(service.page).toHaveBeenLastCalledWith("user-1", {
    planId: null,
    workspaceId: "workspace",
  });
});

it("falls back to the empty editor without a workspace it may not open", async () => {
  service.summaries.mockResolvedValue([]);
  service.page.mockImplementation(async (userId, selection) => {
    if (selection.workspaceId !== null)
      throw new AgentError("plan_access_denied");
    return { userId, selected: null, plans: [], runs: [], workspaces: [] };
  });

  const result = await load("?workspaceId=hidden");

  expect(result.data).toMatchObject({
    opening: "defaultMissing",
    selected: null,
  });
  expect(service.page).toHaveBeenLastCalledWith("user-1", {
    planId: null,
    workspaceId: null,
  });
});

it("treats a malformed plan identifier like a missing plan without looking it up", async () => {
  serve([plan("alpha")]);

  const result = await load(`?planId=${"x".repeat(101)}`);

  expect(result.data.opening).toBe("requestedMissing");
  expect(service.page).toHaveBeenCalledOnce();
  expect(service.page).toHaveBeenCalledWith("user-1", {
    planId: null,
    workspaceId: null,
  });
});

it("opens no plan when none carries the default name", async () => {
  serve([plan("alpha", "Alpha")]);

  const result = await load("?workspaceId=workspace");

  expect(result.data).toMatchObject({
    opening: "defaultMissing",
    selected: null,
  });
});

it("answers a refused empty editor and other failures with safe responses", async () => {
  service.page.mockRejectedValue(new AgentError("plan_access_denied"));
  expect((await thrown("?planId=alpha")).status).toBe(403);

  service.page.mockRejectedValue(new AgentError("plan_conflict"));
  expect((await thrown("?planId=alpha")).status).toBe(409);

  service.page
    .mockReset()
    .mockRejectedValueOnce(new AgentError("plan_access_denied"))
    .mockRejectedValueOnce(new Error("db down"));
  const failure = await thrown("?planId=alpha");
  expect(failure.status).toBe(500);
  expect(await failure.json()).toEqual({
    ok: false,
    intent: "",
    error: "general",
  });

  service.page
    .mockReset()
    .mockRejectedValueOnce(new AgentError("plan_access_denied"))
    .mockRejectedValueOnce(new AgentError("plan_conflict"));
  expect((await thrown("?planId=alpha&workspaceId=workspace")).status).toBe(
    409,
  );
});

it("does not hide an unexpected failure while reading the requested plan", async () => {
  serve([plan("alpha")]);
  vi.mocked(readPlanText).mockImplementationOnce(() => {
    throw new TypeError("broken reader");
  });

  const response = await thrown("?planId=alpha");

  expect(response.status).toBe(500);
  expect(service.page).not.toHaveBeenCalled();
});

/** Renders the route with loader data that shows the given plan. */
async function renderRoute(
  selected: { readonly id: string } | null,
): Promise<void> {
  const preference = {
    userId: "user-1",
    origin: "http://pages.invalid",
    planId: selected?.id ?? null,
    discardedPlanId: null,
  };
  const router = createMemoryRouter([
    {
      path: "/",
      loader: () => ({
        userId: "user-1",
        selected,
        plans: [],
        runs: [],
        workspaces: [],
        opening: selected ? "requested" : "defaultMissing",
        catalogRefresh: REFRESH,
        selectionPreference: preference,
      }),
      Component: AgentPlansRoute,
    },
  ]);
  render(<RouterProvider router={router} />);
  await screen.findByRole("main");
  expect(usePlanSelectionPreference).toHaveBeenCalledWith(preference);
}

it("shows the retired notice and the editor of the opened plan", async () => {
  await renderRoute({ id: "alpha" });

  expect(screen.getByRole("complementary").textContent).toBe("Retired");
  expect(screen.getByRole("main").textContent).toBe(
    `alpha requested ${REFRESH.url}`,
  );
});

it("shows the empty editor when no plan opened", async () => {
  await renderRoute(null);

  expect(screen.getByRole("main").textContent).toBe(
    `none defaultMissing ${REFRESH.url}`,
  );
});
