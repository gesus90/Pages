import { useState } from "react";
import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  Link,
  Outlet,
  redirect,
  RouterProvider,
  useLoaderData,
} from "react-router";

import { PlanLeaveGuard } from "@/app/components/agents/plans/plan-leave-guard";
import { PlanPanelContext } from "@/app/components/agents/plans/plan-panel-context";
import { usePlanSelectionPreference } from "@/app/components/agents/plans/use-plan-selection-preference";
import { planSelectionCookie } from "@/app/lib/agent-plan-selection";
import { createI18n } from "@/app/lib/i18n";

import type { AgentPlanPage, AgentPlanView } from "@/definition/AgentPlan";
import type {
  PlanSelectionPreference,
  PlanSelectionScope,
} from "@/app/lib/agent-plan-selection";

/** Controlled loader boundary for navigation ordering; no server or network is executed. */
export interface SelectionServer {
  userId: string;
  plans: readonly AgentPlanView[];
  waitForRestore?: Promise<void>;
}

interface SelectionPage {
  readonly page: AgentPlanPage;
  readonly preference: PlanSelectionPreference;
}

/** Independently named saved plans, with stable identifiers. */
export function selectionServer(): SelectionServer {
  return {
    userId: "owner",
    plans: ["Plus Local", "Second", "Linked"].map((name, index) => ({
      id: `plan-${index}`,
      name,
      ownerId: "owner",
      workspaceId: "workspace",
      projectId: "project",
      projectName: "Project",
      github: null,
      usage: "private",
      globals: {},
      nodes: [],
      edges: [],
      revision: 1,
      canEdit: true,
    })),
  };
}

/** Public browser scope, including the current instance's port. */
export function selectionScope(userId = "owner"): PlanSelectionScope {
  return { userId, origin: window.location.origin };
}

/** Reads the actual preference cookie, without a mocked storage adapter. */
export async function storedPlan(userId = "owner"): Promise<unknown> {
  return planSelectionCookie(selectionScope(userId)).parse(document.cookie);
}

async function load(
  server: SelectionServer,
  request: Request,
): Promise<SelectionPage | Response> {
  const scope = selectionScope(server.userId);
  const remembered: unknown = await planSelectionCookie(scope).parse(
    document.cookie,
  );
  const explicit = new URL(request.url).searchParams.get("planId");
  const id = explicit ?? remembered;
  // Capture the result before the held response, as an already executing loader would.
  const selected = server.plans.find((plan) => plan.id === id) ?? null;
  const result = {
    page: {
      userId: server.userId,
      plans: server.plans,
      selected,
      workspaces: [],
      sources: { agents: [], tasks: [] },
      runs: [],
      directory: { persons: [], groups: [], departments: [] },
    },
    preference: {
      ...scope,
      planId: selected?.id ?? null,
      discardedPlanId:
        typeof remembered === "string" &&
        (explicit === null || explicit === remembered)
          ? remembered
          : null,
    },
  };
  if (explicit === null) await server.waitForRestore;
  if (selected && explicit === null)
    return redirect(`/agents/plans?planId=${encodeURIComponent(selected.id)}`);
  return result;
}

function SelectionEditor({
  loaded,
}: {
  readonly loaded: SelectionPage;
}): React.ReactElement {
  const [draft, setDraft] = useState(loaded.page.selected?.name ?? "");
  return (
    <>
      <h1>{loaded.page.selected?.name ?? "Empty"}</h1>
      <PlanPanelContext page={loaded.page} />
      <label>
        Draft
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <PlanLeaveGuard isDirty={draft !== (loaded.page.selected?.name ?? "")} />
    </>
  );
}

function SelectionRoute(): React.ReactElement {
  const loaded = useLoaderData<SelectionPage>();
  usePlanSelectionPreference(loaded.preference);
  return (
    <SelectionEditor
      key={`${loaded.page.userId}:${loaded.page.selected?.id}`}
      loaded={loaded}
    />
  );
}

function Navigation(): React.ReactElement {
  return (
    <>
      <Link to="/tickets">Tickets</Link>
      <Link to="/agents/plans">Agents Plan</Link>
      <Link to="/agents/plans?planId=plan-2">Explicit link</Link>
      <Outlet />
    </>
  );
}

/** Mounts the real preference hook, plan dropdown and dirty navigation guard around a mocked loader. */
export function mountSelection(
  server: SelectionServer,
  address = "/agents/plans?planId=plan-0",
): {
  readonly router: ReturnType<typeof createMemoryRouter>;
  readonly unmount: () => void;
} {
  const router = createMemoryRouter(
    [
      {
        Component: Navigation,
        children: [
          {
            path: "/agents/plans",
            loader: ({ request }) => load(server, request),
            Component: SelectionRoute,
          },
          { path: "/tickets", element: <h1>Tickets</h1> },
        ],
      },
    ],
    { initialEntries: [address] },
  );
  const rendered = render(
    <I18nextProvider i18n={createI18n("en")}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
  return { router, unmount: rendered.unmount };
}
