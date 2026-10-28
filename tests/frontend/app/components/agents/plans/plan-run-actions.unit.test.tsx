import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanRunActions } from "@/app/components/agents/plans/plan-run-actions";

import { i18n, planControl, renderTranslated } from "./plan-panel-fixture";

import type {
  PlanRecoveryResumeState,
  PlanRunIntent,
} from "@/app/components/agents/plans/plan-run-actions";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";

interface ActionsOptions {
  readonly control?: AgentPlanControl;
  readonly isReadOnly?: boolean;
  readonly isPending?: boolean;
  readonly pendingIntent?: PlanRunIntent | null;
  readonly isDirty?: boolean;
  readonly hasDeletedFrontier?: boolean;
  readonly recovery?: PlanRecoveryResumeState | null;
}

function renderActions(options: ActionsOptions = {}): {
  readonly onAction: ReturnType<typeof vi.fn>;
  readonly onRecover: ReturnType<typeof vi.fn>;
} {
  const onAction = vi.fn();
  const onRecover = vi.fn();
  renderTranslated(
    <PlanRunActions
      control={"control" in options ? options.control : planControl()}
      isReadOnly={options.isReadOnly ?? false}
      isPending={options.isPending ?? false}
      pendingIntent={options.pendingIntent ?? null}
      isDirty={options.isDirty ?? false}
      hasDeletedFrontier={options.hasDeletedFrontier ?? false}
      recovery={options.recovery ?? null}
      onAction={onAction}
      onRecover={onRecover}
    />,
  );
  return { onAction, onRecover };
}

function action(name: "play" | "pause" | "resume" | "stop"): HTMLElement {
  return screen.getByRole("button", { name: i18n.t(`plans.panel.${name}`) });
}

function title(button: HTMLElement): string | undefined {
  return button.parentElement?.title;
}

function isBusy(button: HTMLElement): boolean {
  return button.querySelector(".animate-spin") !== null;
}

it("starts a new run of a saved, ready plan and nothing else", () => {
  const { onAction } = renderActions();

  expect(
    screen
      .getByRole("group", { name: i18n.t("plans.panel.actions") })
      .getAttribute("aria-busy"),
  ).toBe("false");
  expect(title(action("play"))).toBe(i18n.t("plans.panel.newRunHint"));
  expect(action("pause").hasAttribute("disabled")).toBe(true);
  expect(title(action("pause"))).toBe(i18n.t("plans.panel.pauseHint"));
  expect(action("stop").hasAttribute("disabled")).toBe(true);
  expect(title(action("stop"))).toBe(i18n.t("plans.panel.stopHint"));
  fireEvent.click(action("play"));

  expect(onAction).toHaveBeenCalledWith("play-plan");
});

it.each<[string, ActionsOptions, string]>([
  ["a reader", { isReadOnly: true }, "plans.flow.storage.readOnly"],
  ["unsaved changes", { isDirty: true }, "plans.panel.unsaved"],
  ["an unknown state", { control: undefined }, "plans.panel.checking"],
  [
    "an active run",
    { control: planControl({ status: "stopping", canPlay: false }) },
    "plans.panel.stopFirst",
  ],
  [
    "a stored refusal",
    { control: planControl({ issue: "plan_invalid", canPlay: false }) },
    "plans.panel.blockedHint",
  ],
  [
    "findings",
    {
      control: planControl({
        canPlay: false,
        issues: [{ nodeId: null, port: null, reason: "start" }],
      }),
    },
    "plans.panel.blockedHint",
  ],
  [
    "an empty finding list",
    { control: planControl({ issues: [] }) },
    "plans.panel.newRunHint",
  ],
])("explains Start for %s", (name, options, key) => {
  renderActions(options);

  expect(title(action("play"))).toBe(i18n.t(key));
});

it("keeps Start closed while a request is on its way and shows its progress", () => {
  renderActions({ isPending: true, pendingIntent: "play-plan" });

  expect(action("play").hasAttribute("disabled")).toBe(true);
  expect(isBusy(action("play"))).toBe(true);
  expect(isBusy(action("pause"))).toBe(false);
  expect(screen.getByRole("group").getAttribute("aria-busy")).toBe("true");
});

it("pauses and stops a running run", () => {
  const { onAction } = renderActions({
    control: planControl({
      status: "running",
      canPlay: false,
      canPause: true,
      canStop: true,
    }),
  });

  fireEvent.click(action("pause"));
  fireEvent.click(action("stop"));

  expect(onAction.mock.calls).toEqual([["pause-plan"], ["stop-plan"]]);
});

it("shows a requested pause and stop as in progress", () => {
  const view = renderActions({
    control: planControl({ status: "pausing", canStop: true }),
  });
  expect(isBusy(action("pause"))).toBe(true);
  expect(title(action("pause"))).toBe(i18n.t("plans.panel.pausingHint"));
  expect(screen.getByRole("group").getAttribute("aria-busy")).toBe("true");
  expect(view.onAction).not.toHaveBeenCalled();
});

it("names a stopping run on its Stop button and keeps it closed", () => {
  renderActions({
    control: planControl({ status: "stopping", canStop: true }),
  });

  expect(action("stop").hasAttribute("disabled")).toBe(true);
  expect(isBusy(action("stop"))).toBe(true);
  expect(title(action("stop"))).toBe(i18n.t("plans.panel.stoppingHint"));
});

it("shows the progress of a requested stop or pause", () => {
  renderActions({ pendingIntent: "stop-plan" });
  expect(isBusy(action("stop"))).toBe(true);
});

it("continues a paused run as the only way forward", () => {
  const { onAction } = renderActions({
    control: planControl({ status: "paused", canPlay: false, canResume: true }),
    pendingIntent: "resume-plan",
  });
  const resume = action("resume");

  expect(title(resume)).toBe(i18n.t("plans.panel.resumeHint"));
  expect(resume.className).toContain("bg-primary");
  expect(isBusy(resume)).toBe(true);
  fireEvent.click(resume);

  expect(onAction).toHaveBeenCalledWith("resume-plan");
});

it.each<[string, ActionsOptions, string]>([
  ["unsaved changes", { isDirty: true }, "plans.panel.unsaved"],
  [
    "a deleted frontier",
    { hasDeletedFrontier: true },
    "settings.agents.error.plan_continuation_deleted",
  ],
  [
    "a stored refusal",
    { control: planControl({ status: "paused", issue: "plan_pause_lost" }) },
    "settings.agents.error.plan_pause_lost",
  ],
])("keeps a paused run from continuing with %s", (name, options, key) => {
  renderActions({
    control: planControl({ status: "paused", canResume: true }),
    ...options,
  });
  const resume = action("resume");

  expect(title(resume)).toBe(i18n.t(key));
  expect(resume.hasAttribute("disabled")).toBe(true);
  expect(resume.className).not.toContain("bg-primary");
});

it("opens the decision how a failed run continues, and names why it cannot", () => {
  const { onRecover, onAction } = renderActions({
    control: planControl({ status: "failed" }),
    recovery: { isAvailable: true, reason: null },
    pendingIntent: "pause-plan",
  });
  const resume = action("resume");

  expect(title(resume)).toBe(i18n.t("plans.panel.recoverHint"));
  expect(resume.className).not.toContain("bg-primary");
  expect(isBusy(resume)).toBe(true);
  fireEvent.click(resume);

  expect(onRecover).toHaveBeenCalledOnce();
  expect(onAction).not.toHaveBeenCalled();
});

it("names why a failed run cannot be continued", () => {
  renderActions({
    control: planControl({ status: "failed" }),
    recovery: { isAvailable: false, reason: "A newer run exists." },
  });

  expect(action("resume").hasAttribute("disabled")).toBe(true);
  expect(title(action("resume"))).toBe("A newer run exists.");
});
