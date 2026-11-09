import { ArrowLeft, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { ConsoleRunPicker } from "./console-run-picker";
import { ConsoleStopRun } from "./console-stop-run";

import type { AgentPlanRun, AgentPlanRunSummary } from "@/definition/AgentPlan";

interface ConsoleHeaderProps {
  readonly title: string;
  readonly nodeType: string;
  readonly runs: readonly AgentPlanRunSummary[];
  readonly run: AgentPlanRun | null;
  readonly provider: string | null;
  /** The translated state of the node, such as „Turn läuft“; absent before a session. */
  readonly stateLabel: string | null;
  readonly headingRef: React.RefObject<HTMLHeadingElement | null>;
  readonly onSelectRun: (id: string) => void;
  readonly onClose: () => void;
  /** Returns from a group member to the group's member list. */
  readonly onBack?: () => void;
  /** Stops the whole run; absent when the run cannot be stopped from here. */
  readonly onStopRun?: () => Promise<void>;
}

/** A small label of the header, such as the provider or the state. */
function Pill({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <span className="rounded-md bg-agent-console-pill px-1.5 py-px text-agent-console-muted">
      {children}
    </span>
  );
}

/**
 * Title, provider and state of the node, run choice, the stop of the run and close (PAGE-284).
 *
 * @remarks
 * The title is the node; below it the provider and the state stand as two
 * pills. The red stop is there only while the run can still be stopped.
 */
export function ConsoleHeader(props: ConsoleHeaderProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-agent-console-border bg-agent-console-surface px-5 py-3">
      {props.onBack ? (
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-agent-console-muted hover:bg-agent-console-pill hover:text-agent-console-foreground"
          onClick={props.onBack}
          aria-label={t("plans.console.backToGroup")}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Button>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="sr-only">
          {t("plans.console.kicker", { type: props.nodeType })}
        </p>
        <h2
          ref={props.headingRef}
          tabIndex={-1}
          className="truncate text-[18px] leading-6 font-bold text-agent-console-foreground outline-none"
        >
          {props.title}
        </h2>
        <div
          role="status"
          className="mt-1 flex flex-wrap items-center gap-1.5 text-xs"
        >
          {props.provider ? (
            <Pill>{t(`settings.agents.provider.${props.provider}`)}</Pill>
          ) : null}
          {props.stateLabel ? <Pill>{props.stateLabel}</Pill> : null}
          {props.run?.manualInputAt ? (
            <Pill>{t("plans.console.manualInput")}</Pill>
          ) : null}
          {props.run?.status === "work_done_closeout_open" ? (
            <Pill>{t("plans.status.work_done_closeout_open")}</Pill>
          ) : null}
        </div>
      </div>
      {props.runs.length > 1 ? (
        <ConsoleRunPicker
          ariaLabel={t("plans.console.run")}
          runs={props.runs}
          selectedId={props.run?.id ?? ""}
          onSelect={props.onSelectRun}
        />
      ) : null}
      {props.onStopRun ? <ConsoleStopRun onStop={props.onStopRun} /> : null}
      <Button
        size="icon-sm"
        variant="ghost"
        className="text-agent-console-muted hover:bg-agent-console-pill hover:text-agent-console-foreground"
        onClick={props.onClose}
        aria-label={t("plans.console.close")}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </header>
  );
}
