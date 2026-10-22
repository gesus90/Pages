import { Check, Circle, CircleAlert, LoaderCircle, Minus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import {
  SETUP_PHASES,
  SETUP_PREPARATION_STEPS,
} from "@/definition/RemoteSetup";

import { effectiveSetupProgress, shownPhaseIndex } from "./setup-view";

import type { LucideIcon } from "lucide-react";
import type { RemoteConsoleState } from "@/definition/RemoteConsole";
import type {
  SetupPhaseState,
  SetupPreparationStep,
  SetupProgress,
} from "@/definition/RemoteSetup";
import type { ConsoleView } from "./console-view";

const SEGMENT_TONES: Record<SetupPhaseState, string> = {
  pending: "bg-border",
  running: "bg-primary",
  waiting: "bg-warning",
  done: "bg-success-dot",
  skipped: "bg-muted-foreground",
  failed: "bg-destructive",
};
const PHASE_ICONS: Record<SetupPhaseState, LucideIcon> = {
  pending: Circle,
  running: LoaderCircle,
  waiting: CircleAlert,
  done: Check,
  skipped: Minus,
  failed: CircleAlert,
};

/** The preparation steps before the script runs, each done, current, failed or waiting its turn. */
function preparationStateOf(
  progress: SetupProgress,
  index: number,
): SetupPhaseState {
  const current = progress.step;
  // Once the script runs, Pages has done every step of its own.
  if (current === null) return "done";
  const position = SETUP_PREPARATION_STEPS.indexOf(current);
  if (index < position) return "done";
  if (index > position) return "pending";
  return progress.phases[0] === "failed" ? "failed" : "running";
}

function PreparationSteps(props: {
  readonly progress: SetupProgress;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { progress } = props;
  const isVisible = progress.step !== null || progress.phases[0] === "failed";
  if (!isVisible) return null;
  return (
    <ol
      aria-label={t("remote.setup.preparation.label")}
      className="flex flex-wrap gap-x-5 gap-y-1 text-xs"
    >
      {SETUP_PREPARATION_STEPS.map(
        (step: SetupPreparationStep, index: number) => {
          const state = preparationStateOf(progress, index);
          const Icon = PHASE_ICONS[state];
          return (
            <li
              key={step}
              className={cn(
                "flex items-center gap-1.5",
                state === "pending" && "text-muted-foreground",
                state === "failed" && "text-destructive",
                state === "done" && "text-success",
              )}
            >
              <Icon
                aria-hidden="true"
                className={cn(
                  "size-3.5",
                  state === "running" && "motion-safe:animate-spin",
                )}
              />
              {t(`remote.setup.preparation.${step}`)}
              <span className="sr-only">
                {t(`remote.setup.state.${state}`)}
              </span>
            </li>
          );
        },
      )}
    </ol>
  );
}

function PhaseBar(props: {
  readonly progress: SetupProgress;
}): React.ReactElement {
  const { t } = useTranslation();
  // A finished run marks no phase as current, except the one that failed.
  const shown =
    props.progress.outcome === null
      ? shownPhaseIndex(props.progress)
      : props.progress.phases.indexOf("failed");
  return (
    <ol
      className="grid grid-cols-8 gap-2"
      aria-label={t("remote.setup.phasesLabel")}
    >
      {SETUP_PHASES.map((phase, index) => {
        const state = props.progress.phases[index] ?? "pending";
        return (
          <li
            key={phase}
            aria-current={index === shown ? "step" : undefined}
            className="min-w-0"
          >
            <span
              aria-hidden="true"
              className={cn("block h-1.5 rounded-full", SEGMENT_TONES[state])}
            />
            <span
              className={cn(
                "mt-1.5 block truncate text-xs",
                index === shown ? "font-medium" : "text-muted-foreground",
              )}
            >
              {index + 1} · {t(`remote.setup.phase.${phase}`)}
              <span className="sr-only">
                {" "}
                {t(`remote.setup.state.${state}`)}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** What the sequence is doing now, or how it ended; the reason is a stable translation key. */
function useHeadline(progress: SetupProgress): {
  readonly text: string;
  readonly tone: string;
} {
  const { t } = useTranslation();
  const shown = shownPhaseIndex(progress);
  const phase = SETUP_PHASES[Math.min(shown, SETUP_PHASES.length - 1)];
  const reason = progress.reason === null ? "" : t(progress.reason);
  if (progress.outcome === "confirmed")
    return { text: t("remote.setup.headline.confirmed"), tone: "text-success" };
  if (progress.outcome === "partial")
    return {
      text: t("remote.setup.headline.partial", { reason }),
      tone: "text-warning",
    };
  if (progress.outcome === "failed")
    return {
      text: t("remote.setup.headline.failed", {
        phase: t(`remote.setup.phase.${phase}`),
        reason,
      }),
      tone: "text-destructive",
    };
  if (progress.phases[shown] === "waiting")
    return {
      text: t("remote.setup.headline.waiting", {
        phase: t(`remote.setup.phase.${phase}`),
      }),
      tone: "text-warning",
    };
  return {
    text: t("remote.setup.headline.running", {
      number: shown + 1,
      count: SETUP_PHASES.length,
      phase: t(`remote.setup.phase.${phase}`),
    }),
    tone: "text-foreground",
  };
}

/**
 * The guided sequence above the terminal: greeting, eight phases with their
 * state, and the steps Pages takes before the script runs.
 *
 * @remarks
 * A failed phase stops the sequence: no later phase is drawn as running. The
 * state is exactly what the server reports; the browser decides nothing.
 */
export function SetupProgressPanel(props: {
  readonly state: RemoteConsoleState;
  readonly view: ConsoleView;
  readonly hostName: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const progress = effectiveSetupProgress(props.state, props.view);
  const headline = useHeadline(progress);
  return (
    <section
      aria-label={t("remote.setup.sectionLabel")}
      className="shrink-0 space-y-3 border-t border-border bg-surface px-6 py-4"
    >
      <p className="text-sm text-muted-foreground">
        {t("remote.setup.greeting", { name: props.hostName })}
      </p>
      <PhaseBar progress={progress} />
      <p
        role="status"
        aria-live="polite"
        className={cn("text-sm font-medium", headline.tone)}
      >
        {headline.text}
      </p>
      <PreparationSteps progress={progress} />
    </section>
  );
}
