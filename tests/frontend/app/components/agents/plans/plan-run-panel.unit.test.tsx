import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { PlanRunPanel } from "@/app/components/agents/plans/plan-run-panel";
import { createI18n } from "@/app/lib/i18n";

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

function renderPanelWithBlock(
  block: NonNullable<AgentPlanControl["resumeBlock"]>,
): { readonly unmount: () => void } {
  const scene = actionScene();
  const page = planPage();
  return renderWithEditor(page, scene, (editor: PlanEditor) => (
    <PlanRunPanel
      page={page}
      editor={editor}
      control={planControl({
        ...FAILED,
        resumeKind: "failed",
        resumeBlock: block,
      })}
      run={null}
      error={null}
      onRunStarted={vi.fn()}
      onRecoveryDecided={vi.fn()}
    />
  ));
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

it("continues an ended run with one click and no dialog", async () => {
  const { scene } = renderPanel({
    control: planControl({
      ...FAILED,
      resumeKind: "failed",
      canResume: true,
    }),
  });

  fireEvent.click(button("resume"));

  await waitFor(() => expect(scene.submissions).toHaveLength(1));
  expect(scene.submissions[0]?.get("intent")).toBe("resume-plan");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("shows why Fortsetzen is off as text and carries out the action that lifts it", async () => {
  const submit = vi.fn<PlanRecovery["submit"]>(async () => null);
  recovery({ view: RESUMABLE, submit });
  const fetchMock = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
  const onDecided = renderPanel({
    control: planControl({
      ...FAILED,
      resumeKind: "failed",
      resumeBlock: {
        code: "plan_script_permission_denied",
        action: "admin_mode",
      },
    }),
  }).onRecoveryDecided;

  expect(button("resume").hasAttribute("disabled")).toBe(true);
  fireEvent.click(button("expand"));
  expect(
    screen
      .getAllByRole("status")
      .some((element) =>
        element.textContent?.includes(
          i18n.t("plans.resumeBlock.reason.plan_script_permission_denied"),
        ),
      ),
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.resumeBlock.button.admin_mode"),
    }),
  );

  await waitFor(() => expect(onDecided).toHaveBeenCalledOnce());
  expect(fetchMock).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});

it("releases the reservations or opens the restart when the block names that action", async () => {
  const submit = vi.fn<PlanRecovery["submit"]>(async () => null);
  recovery({ view: RESUMABLE, submit });
  const { unmount } = renderPanelWithBlock({
    code: "cleanup_unconfirmed",
    action: "release",
  });

  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.resumeBlock.button.release"),
    }),
  );
  expect(submit).toHaveBeenCalledWith({ action: "release" });
  unmount();
  renderPanelWithBlock({ code: "no_safe_state", action: "restart" });

  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.resumeBlock.button.restart"),
    }),
  );
  expect(
    await screen.findByRole("dialog", {
      name: i18n.t("plans.recovery.restart"),
    }),
  ).toBeDefined();
});

it("asks before it ends an open run for a new one, and sends the confirmation", async () => {
  const { scene } = renderPanel({
    control: planControl({
      runId: "run-1",
      status: "running",
      canPlay: true,
      canRestart: true,
      canStop: true,
    }),
  });

  fireEvent.click(button("play"));
  expect(scene.submissions).toHaveLength(0);
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.openRun.confirm") }),
  );

  await waitFor(() => expect(scene.submissions).toHaveLength(1));
  expect(scene.submissions[0]?.get("replaceOpenRun")).toBe("true");
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

it("states in English and German why Fortsetzen refused a skipped script that is enabled again", async () => {
  renderPanel({
    control: planControl({
      runId: "run-1",
      status: "paused",
      resumeKind: "paused",
      canResume: true,
    }),
    scene: actionScene({
      ok: false,
      intent: "resume-plan",
      error: "plan_skipped_step_enabled",
      nodeId: "prepare",
    }),
  });

  fireEvent.click(button("resume"));

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
    "A script that this run skipped is now enabled. Start the run anew.",
  );
  expect(
    createI18n("de").t("settings.agents.error.plan_skipped_step_enabled"),
  ).toBe(
    "Ein in diesem Lauf übersprungenes Skript ist jetzt eingeschaltet. Starten Sie den Lauf neu.",
  );
});

it("names an enabled skipped script as the block of an ended run and offers a new start", () => {
  renderPanelWithBlock({
    code: "plan_skipped_step_enabled",
    action: "restart",
  });

  expect(button("resume").hasAttribute("disabled")).toBe(true);
  fireEvent.click(button("expand"));
  expect(
    screen
      .getAllByRole("status")
      .some((element) =>
        element.textContent?.includes(
          "A script that this run skipped is now enabled. Start anew.",
        ),
      ),
  ).toBe(true);
  expect(
    createI18n("de").t("plans.resumeBlock.reason.plan_skipped_step_enabled"),
  ).toBe("Ein in diesem Lauf übersprungenes Skript ist jetzt eingeschaltet.");
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
