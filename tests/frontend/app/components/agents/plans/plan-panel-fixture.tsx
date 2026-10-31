import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";

import { usePlanEditor } from "@/app/components/agents/plans/use-plan-editor";
import { createI18n } from "@/app/lib/i18n";

import type { RenderResult } from "@testing-library/react";
import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type { usePlanRecovery } from "@/app/components/agents/plans/use-plan-recovery";
import type {
  AgentPlanInput,
  AgentPlanPage,
  AgentPlanStepResult,
  AgentPlanView,
} from "@/definition/AgentPlan";
import type {
  AgentPlanRemoteProgress,
  AgentPlanStepExecution,
} from "@/definition/AgentPlanExecution";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanRecoveryView } from "@/definition/AgentPlanRecovery";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

/** The English translations the plan editor shows in these units. */
export const i18n = createI18n("en");

/** The editor state a harness renders the subject with. */
export type PlanEditor = ReturnType<typeof usePlanEditor>;

/** The recovery state a panel receives from its hook. */
export type PlanRecovery = ReturnType<typeof usePlanRecovery>;

/** A saved, editable plan of the owner in the synthetic workspace. */
export function planView(
  overrides: Partial<AgentPlanView> = {},
): AgentPlanView {
  return {
    id: "plan",
    name: "Synthetic plan",
    ownerId: "owner",
    workspaceId: "workspace",
    projectId: "project",
    projectName: "Project",
    github: null,
    usage: "private",
    globals: {},
    nodes: [],
    edges: [],
    revision: 3,
    canEdit: true,
    ...overrides,
  };
}

/** The plan page of the owner with one workspace and the given plan selected. */
export function planPage(
  overrides: Partial<AgentPlanPage> = {},
): AgentPlanPage {
  const selected =
    "selected" in overrides ? (overrides.selected ?? null) : planView();
  return {
    userId: "owner",
    plans: selected ? [selected] : [],
    workspaces: [
      {
        id: "workspace",
        name: "Workspace",
        path: "/synthetic",
        projectId: "project",
        projectName: "Project",
        github: null,
        isUsable: true,
        reason: null,
      },
    ],
    selected,
    sources: { agents: [], tasks: [] },
    runs: [],
    directory: { persons: [], groups: [], departments: [] },
    ...overrides,
  };
}

/** The control state of an idle plan that may start. */
export function planControl(
  overrides: Partial<AgentPlanControl> = {},
): AgentPlanControl {
  return {
    runId: null,
    status: "idle",
    canPlay: true,
    canPause: false,
    canResume: false,
    canStop: false,
    canEdit: true,
    issue: null,
    planRevision: null,
    continuationVersion: 0,
    frontierStepIds: [],
    ...overrides,
  };
}

/** The recovery view of a failed run whose actions are all unavailable. */
export function recoveryView(
  overrides: Partial<AgentPlanRecoveryView> = {},
): AgentPlanRecoveryView {
  return {
    runId: "run-1",
    planId: "plan",
    stepNames: { first: "Reviewer", second: "Writer" },
    revision: 7,
    planRevision: 2,
    currentPlanRevision: 3,
    origin: null,
    continuedBy: null,
    isCleanupUnconfirmed: false,
    cleanupResources: [],
    restart: { available: false, reason: null },
    resume: {
      available: false,
      reason: null,
      modes: [],
      reusedStepIds: [],
      reviewStepIds: [],
    },
    release: { available: false, reason: null },
    executions: [],
    state: "recoverable",
    checkpoint: null,
    attempts: [],
    nodes: [],
    allowedActions: [],
    blockers: [],
    ...overrides,
  };
}

/** The recovery hook's answer: nothing loaded, nothing pending, a spy for decisions. */
export function recoveryState(
  overrides: Partial<PlanRecovery> = {},
): PlanRecovery {
  return {
    view: null,
    error: null,
    cleanupFailure: null,
    isPending: false,
    result: null,
    submit: vi.fn(async () => null),
    ...overrides,
  };
}

/** Renders an element with the English translations only. */
export function renderTranslated(element: React.ReactElement): RenderResult {
  return render(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>);
}

/** Renders an element with translations inside a memory router at the given address. */
export function renderRouted(
  element: React.ReactElement,
  address = "/agents/plans?planId=plan",
): RenderResult & { readonly router: ReturnType<typeof createMemoryRouter> } {
  const router = createMemoryRouter([{ path: "*", element }], {
    initialEntries: [address],
  });
  const rendered = render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
  return { ...rendered, router };
}

/** The synthetic plan action: what it answers and what it received. */
export interface PlanActionScene {
  answer: AgentPlanActionResult;
  /** Answers given to the next submissions, one each, before `answer` applies. */
  readonly answers?: AgentPlanActionResult[];
  readonly submissions: FormData[];
  /** Holds the answer until it resolves, so the pending state stays visible. */
  hold?: Promise<void>;
  /**
   * Gives the route a loader whose reload follows every answer, which `reload` can hold.
   *
   * @remarks
   * A route with a loader renders after the first load, so such a scene is awaited.
   */
  readonly hasLoader?: boolean;
  /** Holds the reload of the page data that follows an answer. */
  reload?: Promise<void>;
}

/** An action that answers with the given result, by default an accepted save. */
export function actionScene(
  answer: AgentPlanActionResult = { ok: true, intent: "save-plan" },
): PlanActionScene {
  return { answer, submissions: [] };
}

function EditorHarness(props: {
  readonly page: AgentPlanPage;
  readonly subject: (editor: PlanEditor) => React.ReactNode;
}): React.ReactElement {
  const editor = usePlanEditor(props.page);
  return (
    <>
      <button
        type="button"
        onClick={() => editor.rename(`${editor.draft.name} edited`)}
      >
        Edit draft
      </button>
      <button type="button" onClick={editor.save}>
        Submit draft
      </button>
      {props.subject(editor)}
    </>
  );
}

/**
 * Renders a subject with the real plan editor of a page, whose save and run
 * requests reach a synthetic action instead of a server.
 */
export function renderWithEditor(
  page: AgentPlanPage,
  scene: PlanActionScene,
  subject: (editor: PlanEditor) => React.ReactNode,
): RenderResult & { readonly router: ReturnType<typeof createMemoryRouter> } {
  const router = createMemoryRouter(
    [
      {
        path: "/agents/plans",
        element: <EditorHarness page={page} subject={subject} />,
        ...(scene.hasLoader
          ? {
              loader: async () => {
                await scene.reload;
                return null;
              },
            }
          : {}),
        action: async ({ request }) => {
          scene.submissions.push(await request.formData());
          await scene.hold;
          return scene.answers?.shift() ?? scene.answer;
        },
      },
      { path: "*", element: <p>Elsewhere</p> },
    ],
    { initialEntries: ["/agents/plans?planId=plan"] },
  );
  const rendered = render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
  return { ...rendered, router };
}

/** A plan input with the given nodes, as a draft in the synthetic workspace. */
export function draftOf(
  nodes: AgentPlanInput["nodes"],
  overrides: Partial<AgentPlanInput> = {},
): AgentPlanInput {
  return {
    name: "Synthetic plan",
    workspaceId: "workspace",
    usage: "private",
    globals: {},
    nodes,
    edges: [],
    ...overrides,
  };
}

/** One waiting run step; `overrides` set the state each unit checks. */
export function runStep(
  id: string,
  overrides: Partial<AgentPlanStepResult> = {},
): AgentPlanStepResult {
  return {
    id,
    name: id,
    status: "waiting",
    isBlocked: false,
    cancellation: "none",
    output: null,
    error: null,
    ...overrides,
  };
}

/** The immutable first attempt of a step on the given target. */
export function stepExecution(
  target: AgentPlanStepExecution["target"] = { kind: "local" },
  overrides: Partial<AgentPlanStepExecution> = {},
): AgentPlanStepExecution {
  return {
    schemaVersion: 1,
    planId: "plan",
    runId: "run-1",
    stepId: "step",
    attemptId: "00000000-0000-4000-8000-000000000001",
    planRevision: 3,
    target,
    workspace: { id: "workspace", path: "/synthetic", revision: 1 },
    modelAccess: {
      connectionId: null,
      connectionName: "Synthetic connection",
      provider: "openrouter",
      model: "synthetic-model",
      reasoningEffort: null,
    },
    ...overrides,
  };
}

/** A registered remote target on the host `nas`. */
export const REMOTE_TARGET = {
  kind: "remote",
  connectionId: "connection",
  connectionRevision: 1,
  connectionName: "nas",
  workspaceId: "remote",
  workspaceRevision: 1,
  workspaceName: "Build box",
  path: "/srv/build",
} as const;

/** The reported progress of a running remote job. */
export function remoteProgress(
  overrides: Partial<AgentPlanRemoteProgress> = {},
): AgentPlanRemoteProgress {
  return {
    jobId: "00000000-0000-4000-8000-000000000002",
    sessionId: "00000000-0000-4000-8000-000000000003",
    status: "running",
    startedAt: null,
    endedAt: null,
    closeout: "pending",
    ...overrides,
  };
}

/** A started session of the given runner without reports, process or result. */
export function agentSession(
  runner: AgentPlanSessionRecord["runner"],
  overrides: Partial<AgentPlanSessionRecord> = {},
): AgentPlanSessionRecord {
  return {
    runner,
    mode: "one_shot",
    instanceId: "instance",
    sessionId: null,
    processId: null,
    startedAt: null,
    turnEndedAt: null,
    endedAt: null,
    exit: null,
    closeout: "pending",
    leftoverProcesses: null,
    resultCode: null,
    requested: {
      runner,
      connectionId: "connection",
      connectionName: "Synthetic connection",
      model: "synthetic-model",
      reasoningEffort: null,
      options: null,
      unattended: "request",
      mcp: false,
      directory: "/synthetic",
    },
    effective: null,
    definition: null,
    contract: null,
    acceptance: null,
    events: [],
    ...overrides,
  };
}
