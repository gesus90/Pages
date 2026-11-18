import { ArrowLeft, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import {
  ClaudeProviderBadge,
  NoteBadge,
  StateBadge,
} from "./console-header-badges";
import { ConsoleRunPicker } from "./console-run-picker";
import { ConsoleStopRun } from "./console-stop-run";

import type { AgentPlanRun, AgentPlanRunSummary } from "@/definition/AgentPlan";
import type { HeaderState } from "./console-header-badges";

interface ConsoleHeaderProps {
  readonly title: string;
  readonly nodeType: string;
  readonly runs: readonly AgentPlanRunSummary[];
  readonly run: AgentPlanRun | null;
  readonly provider: string | null;
  /** The state of the node, such as „Turn läuft“; absent before a session. */
  readonly state: HeaderState | null;
  readonly headingRef: React.RefObject<HTMLHeadingElement | null>;
  readonly onSelectRun: (id: string) => void;
  readonly onClose: () => void;
  /** Returns from a group member to the group's member list. */
  readonly onBack?: () => void;
  /** Stops the whole run; absent when the run cannot be stopped from here. */
  readonly onStopRun?: () => Promise<void>;
}

/** Every control of the header: 40 px high with a 12 px radius. */
const CONTROL_CLASS = "min-h-10 xl:min-h-10";

/** The provider of the node: the badge of Claude Code, a plain label for any other runner. */
function ProviderLabel({
  provider,
}: {
  readonly provider: string;
}): React.ReactElement {
  const { t } = useTranslation();
  if (provider === "claude_code") return <ClaudeProviderBadge />;
  return <NoteBadge>{t(`settings.agents.provider.${provider}`)}</NoteBadge>;
}

/**
 * Title, provider and state of the node, run choice, the stop of the run and close.
 * @remarks
 * The header is 76 px high. The title is the node; below it the provider
 * and the state stand as two badges of 24 px. At the right the run choice,
 * the stop and close are 40 px high with a 12 px radius and 8 px apart. The
 * stop is there only while the run can still be stopped.
 */
export function ConsoleHeader(props: ConsoleHeaderProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-agent-console-border bg-agent-console-surface px-5 py-3 sm:h-[76px] sm:flex-nowrap">
      {props.onBack ? (
        <Button
          size="icon-sm"
          variant="outline"
          className={`size-10 ${CONTROL_CLASS}`}
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
        <div role="status" className="mt-1 flex items-center gap-1.5">
          {props.provider ? <ProviderLabel provider={props.provider} /> : null}
          {props.state ? <StateBadge state={props.state} /> : null}
          {props.run?.manualInputAt ? (
            <NoteBadge>{t("plans.console.manualInput")}</NoteBadge>
          ) : null}
          {props.run?.status === "work_done_closeout_open" ? (
            <NoteBadge>{t("plans.status.work_done_closeout_open")}</NoteBadge>
          ) : null}
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2 max-sm:w-full max-sm:justify-end">
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
          variant="outline"
          className={`size-10 ${CONTROL_CLASS}`}
          onClick={props.onClose}
          aria-label={t("plans.console.close")}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </header>
  );
}
