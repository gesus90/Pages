import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { PlanRunPanel } from "@/app/components/agents/plans/plan-run-panel";

import { syntheticRun } from "../page72-run-fixture";
import { agentNode } from "./plan-group-fixture";
import {
  actionScene,
  i18n,
  planControl,
  planPage,
  planView,
  recoveryState,
  recoveryView,
  renderWithEditor,
  runStep,
} from "./plan-panel-fixture";

import type {
  PlanActionScene,
  PlanEditor,
  PlanRecovery,
} from "./plan-panel-fixture";
import type { AgentPlanPage, AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";

const recoveryHook: { state: unknown; calls: unknown[][] } = vi.hoisted(() => ({
  state: undefined,
  calls: [],
}));

vi.mock("@/app/components/agents/plans/use-plan-recovery", () => ({
  usePlanRecovery: (...args: unknown[]) => {
    recoveryHook.calls.push(args);
    return recoveryHook.state;
  },
}));

const FAILED = planControl({
  runId: "run-1",
  status: "failed",
  canPlay: true,
});

const RESUMABLE = recoveryView({
  restart: { available: true, reason: null },
  resume: {
    available: true,
    reason: null,
    modes: [{ mode: "new_session", available: true }],
    reusedStepIds: [],
    reviewStepIds: [],
  },
});

interface PanelOptions {
  readonly control?: AgentPlanControl;
  readonly page?: AgentPlanPage;
  readonly run?: AgentPlanRun | null;
  readonly error?: string | null;
  readonly scene?: PlanActionScene;
}

function renderPanel(options: PanelOptions = {}): {
  readonly scene: PlanActionScene;
  readonly onRunStarted: ReturnType<typeof vi.fn>;
  readonly onRecoveryDecided: ReturnType<typeof vi.fn>;
} {
  const scene = options.scene ?? actionScene();
  const onRunStarted = vi.fn();
  const onRecoveryDecided = vi.fn();
  const page = options.page ?? planPage();
  renderWithEditor(page, scene, (editor: PlanEditor) => (
    <PlanRunPanel
      page={page}
      editor={editor}
      control={"control" in options ? options.control : planControl()}
      run={options.run ?? null}
      error={options.error ?? null}
      onRunStarted={onRunStarted}
      onRecoveryDecided={onRecoveryDecided}
    />
  ));
  return { scene, onRunStarted, onRecoveryDecided };
}

function button(name: string): HTMLElement {
  return screen.getByRole("button", { name: i18n.t(`plans.panel.${name}`) });
}

function title(element: HTMLElement): string | undefined {
  return element.parentElement?.title;
}

function recovery(overrides: Partial<PlanRecovery> = {}): void {
  recoveryHook.state = recoveryState(overrides);
}

beforeEach(() => {
  recoveryHook.calls = [];
  recovery();
});

it("starts a new run of the saved revision without the draft", async () => {
  const { scene } = renderPanel();

  fireEvent.click(button("play"));

  await waitFor(() => expect(scene.submissions).toHaveLength(1));
  expect(Object.fromEntries(scene.submissions[0]?.entries() ?? [])).toEqual({
    intent: "play-plan",
    planId: "plan",
    runId: "",
    revision: "3",
  });
});

it("shows the progress of a start on its button until the server answered", async () => {
  let release = (): void => undefined;
  const scene = actionScene({ ok: true, intent: "play-plan" });
  scene.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  renderPanel({ scene });

  fireEvent.click(button("play"));

  await waitFor(() =>
    expect(button("play").querySelector(".animate-spin")).not.toBeNull(),
  );
  expect(button("play").hasAttribute("disabled")).toBe(true);
  act(() => release());
  await waitFor(() =>
    expect(button("play").querySelector(".animate-spin")).toBeNull(),
  );
});

it("sends pause and stop for the run of the control", async () => {
  const { scene } = renderPanel({
    control: planControl({
      runId: "run-9",
      status: "running",
      canPlay: false,
      canPause: true,
      canStop: true,
    }),
  });

  fireEvent.click(button("pause"));
  await waitFor(() => expect(scene.submissions).toHaveLength(1));
  fireEvent.click(button("stop"));
  await waitFor(() => expect(scene.submissions).toHaveLength(2));

  expect(
    scene.submissions.map((form) => [form.get("intent"), form.get("runId")]),
  ).toEqual([
    ["pause-plan", "run-9"],
    ["stop-plan", "run-9"],
  ]);
});

it("states a running run whose remaining steps wait behind a failure as blocked", () => {
  const run: AgentPlanRun = {
    ...syntheticRun(),
    status: "running",
    steps: [
      runStep("one", { status: "failed" }),
      runStep("two", { isBlocked: true }),
    ],
  };
  renderPanel({
    control: planControl({ status: "running", canPlay: false }),
    run,
  });

  expect(
    screen.getByText(i18n.t("plans.panel.state.runBlocked.label")),
  ).toBeDefined();
});

it("keeps a running run with a running step as running", () => {
  const run: AgentPlanRun = {
    ...syntheticRun(),
    status: "running",
    steps: [
      runStep("one", { status: "running" }),
      runStep("two", { isBlocked: true }),
    ],
  };
  renderPanel({
    control: planControl({ status: "running", canPlay: false }),
    run,
  });

  expect(
    screen.getByText(i18n.t("plans.panel.state.running.label")),
  ).toBeDefined();
});

it("keeps following the recovery of a run that is still active", () => {
  renderPanel({
    control: planControl({ runId: "run-1", status: "running", canPlay: false }),
  });

  const [runId, onRunStarted, following] = recoveryHook.calls[0] ?? [];
  expect(runId).toBe("run-1");
  expect(onRunStarted).toBeTypeOf("function");
  expect(following).toMatchObject({ isRunActive: true });
});

it("passes the recovery hook the run, its start callback and what makes it read again", () => {
  const { onRunStarted, onRecoveryDecided } = renderPanel({ control: FAILED });

  const [runId, started, following] = recoveryHook.calls[0] as [
    string,
    (id: string) => void,
    {
      isRunActive: boolean;
      readKey: string;
      onDecided: () => void;
    },
  ];
  expect(runId).toBe("run-1");
  expect(following.isRunActive).toBe(false);
  expect(JSON.parse(following.readKey)).toEqual([
    "failed",
    0,
    true,
    null,
    null,
    3,
  ]);
  started("run-2");
  following.onDecided();
  expect(onRunStarted).toHaveBeenCalledWith("run-2");
  expect(onRecoveryDecided).toHaveBeenCalledOnce();
});

it("reads no recovery for a plan the person may not edit", () => {
  renderPanel({
    control: FAILED,
    page: planPage({ selected: planView({ canEdit: false }) }),
  });

  expect(recoveryHook.calls[0]?.[0]).toBeNull();
});

it("offers a restart of an ended run in a dialog and starts nothing before the decision", async () => {
  recovery({ view: RESUMABLE });
  const { scene } = renderPanel({
    control: planControl({
      runId: "run-1",
      status: "failed",
      canPlay: true,
      canRestart: true,
    }),
  });

  fireEvent.click(button("play"));

  const dialog = await screen.findByRole("dialog", {
    name: i18n.t("plans.recovery.restart"),
  });
  expect(dialog).toBeDefined();
  expect(scene.submissions).toHaveLength(0);
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("settings.agents.cancel") }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("asks before a new run begins beside the ended run of another executor", async () => {
  const { scene } = renderPanel({
    control: planControl({
      runId: "run-1",
      status: "failed",
      canPlay: true,
      resumeBlocker: "own_run_required",
    }),
  });

  fireEvent.click(button("play"));
  const confirm = screen.getByRole("button", {
    name: i18n.t("plans.recovery.foreignStartAction"),
  });
  expect(confirm.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(confirm);

  await waitFor(() => expect(scene.submissions).toHaveLength(1));
  expect(scene.submissions[0]?.get("intent")).toBe("play-plan");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("continues an ended run through the resume dialog", async () => {
  recovery({ view: RESUMABLE });
  renderPanel({ control: planControl({ ...FAILED, canResume: true }) });

  fireEvent.click(button("resume"));

  expect(
    await screen.findByRole("dialog", {
      name: i18n.t("plans.recovery.resumeTitle"),
    }),
  ).toBeDefined();
});

it.each<[string, Partial<AgentPlanControl>, Partial<PlanRecovery>, string]>([
  [
    "a plan the person may not edit",
    { canEdit: false },
    {},
    "plans.recovery.blocker.plan_read_only",
  ],
  [
    "a run of another executor",
    { resumeBlocker: "own_run_required" },
    {},
    "plans.recovery.blocker.own_run_required",
  ],
  [
    "a run without identity",
    { runId: null },
    {},
    "plans.recovery.blocker.own_run_required",
  ],
  ["a view that is still loading", {}, {}, "plans.panel.checking"],
])(
  "explains why an ended run cannot continue without a view: %s",
  (_, control, hook, key) => {
    recovery(hook);
    renderPanel({ control: planControl({ ...FAILED, ...control }) });

    expect(title(button("resume"))).toBe(i18n.t(key));
    expect(button("resume").hasAttribute("disabled")).toBe(true);
  },
);

it("names the refusal of the recovery view as the reason", () => {
  recovery({ error: "recovery_unavailable" });
  renderPanel({ control: FAILED });

  expect(title(button("resume"))).toBe(
    i18n.t([
      "plans.recovery.error.recovery_unavailable",
      "settings.agents.error.recovery_unavailable",
      "plans.panel.error",
    ]),
  );
});

it("takes the reason of an unavailable resume from the view, else from the control", () => {
  recovery({
    view: recoveryView({
      resume: {
        available: false,
        reason: "already_continued",
        modes: [],
        reusedStepIds: [],
        reviewStepIds: [],
      },
    }),
  });
  renderPanel({ control: FAILED });

  expect(title(button("resume"))).toBe(
    i18n.t("plans.recovery.blocker.already_continued"),
  );
});

it("holds back a resume the view offers while the control names a current blocker", () => {
  recovery({ view: RESUMABLE });
  renderPanel({
    control: planControl({
      ...FAILED,
      canResume: false,
      issue: "plan_invalid",
    }),
  });

  expect(button("resume").hasAttribute("disabled")).toBe(true);
  expect(title(button("resume"))).toBe(
    i18n.t(["settings.agents.error.plan_invalid", "plans.panel.blockedHint"]),
  );
});

it("holds back a resume while a recovery request is on its way", () => {
  recovery({ view: RESUMABLE, isPending: true });
  renderPanel({ control: planControl({ ...FAILED, canResume: true }) });

  expect(button("resume").hasAttribute("disabled")).toBe(true);
});

it("names a paused run whose continuation node was deleted", () => {
  renderPanel({
    page: planPage({
      selected: planView({ nodes: [agentNode("kept", "codex")] }),
    }),
    control: planControl({
      runId: "run-1",
      status: "paused",
      canPlay: false,
      canResume: true,
      frontierStepIds: ["deleted"],
    }),
  });

  expect(button("resume").hasAttribute("disabled")).toBe(true);
  expect(title(button("resume"))).toBe(
    i18n.t("settings.agents.error.plan_continuation_deleted"),
  );
});

it("opens the details and shows the refusal of the surrounding page first", () => {
  renderPanel({ error: "plan_conflict" });

  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp(i18n.t("plans.panel.state.error.label"), "u"),
    }),
  );

  expect(screen.getByRole("alert").textContent).toContain(
    i18n.t("settings.agents.error.plan_conflict"),
  );
});

it("shows the refusal of a run request that no finding explains", async () => {
  renderPanel({
    scene: actionScene({
      ok: false,
      intent: "play-plan",
      error: "plan_workspace_conflict",
    }),
  });

  fireEvent.click(button("play"));

  await waitFor(() =>
    expect(
      screen.getByText(i18n.t("plans.panel.state.error.label")),
    ).toBeDefined(),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp(i18n.t("plans.panel.state.error.label"), "u"),
    }),
  );
  expect(screen.getByRole("alert").textContent).toContain(
    i18n.t("settings.agents.error.plan_workspace_conflict"),
  );
});

it("opens and closes the details with the chevron of the heading as with the status line", () => {
  renderPanel();

  const chevron = screen.getByRole("button", {
    name: i18n.t("plans.panel.expand"),
  });
  expect(chevron.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(chevron);
  expect(
    screen
      .getByRole("button", { name: i18n.t("plans.panel.collapse") })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.panel.collapse") }),
  );
  expect(
    screen
      .getByRole("button", { name: i18n.t("plans.panel.expand") })
      .getAttribute("aria-expanded"),
  ).toBe("false");
});
