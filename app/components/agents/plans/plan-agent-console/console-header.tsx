import { ArrowLeft, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import {
  NoteBadge,
  ProviderBadge,
  StateBadge,
  hasProviderBadge,
} from "./console-header-badges";
import { ConsoleRunPicker } from "./console-run-picker";

import type { AgentPlanRun, AgentPlanRunSummary } from "@/definition/AgentPlan";
import type { HeaderState } from "./console-header-badges";

/** Draws the header of the console for a session: its provider, state, the stop of the run and further badges. */
export type ConsoleHeaderRenderer = (
  provider: string | null,
  state: HeaderState | null,
  onStopRun?: () => Promise<void>,
  badges?: React.ReactNode,
) => React.ReactNode;

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
  /** Further badges after the state, such as the helper count of a swarm. */
  readonly badges?: React.ReactNode;
}

/** The provider badge and the state below the title; model and reasoning stand in the sidebar. */
function ConsoleSessionBadges({
  provider,
  state,
}: Pick<ConsoleHeaderProps, "provider" | "state">): React.ReactElement {
  return (
    <>
      {provider ? <ProviderLabel provider={provider} /> : null}
      {state ? <StateBadge state={state} /> : null}
    </>
  );
}

/** Every control of the header: 40 px high with a 12 px radius. */
const CONTROL_CLASS = "min-h-10 xl:min-h-10";

/** The provider of the node: its provider badge, a plain label for a runner without one. */
function ProviderLabel({
  provider,
}: {
  readonly provider: string;
}): React.ReactElement {
  const { t } = useTranslation();
  if (hasProviderBadge(provider)) return <ProviderBadge provider={provider} />;
  return <NoteBadge>{t(`settings.agents.provider.${provider}`)}</NoteBadge>;
}

/**
 * Title, provider and state of the node, run choice, the stop of the run and close.
 * @remarks
 * The header is 76 px high on wide terminals when the content fits on one
 * row. The provider and state badges below the title flow onto further rows
 * when space is tight. The run choice, stop and close stay grouped on the
 * right. The stop is there only while the run can still be stopped.
 */
export function ConsoleHeader(props: ConsoleHeaderProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-agent-console-border bg-agent-console-surface px-5 py-3 sm:min-h-[76px] sm:py-2">
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
      <div className="min-w-0 grow basis-40">
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
        <div role="status" className="mt-2 flex flex-wrap items-center gap-1.5">
          <ConsoleSessionBadges provider={props.provider} state={props.state} />
          {props.badges}
          {props.run?.manualInputAt ? (
            <NoteBadge>{t("plans.console.manualInput")}</NoteBadge>
          ) : null}
          {props.run?.status === "work_done_closeout_open" ? (
            <NoteBadge>{t("plans.status.work_done_closeout_open")}</NoteBadge>
          ) : null}
        </div>
      </div>
      <div className="ml-auto flex min-w-0 max-w-full items-center gap-2 max-sm:w-full max-sm:justify-end">
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

function ConsoleStopRun({
  onStop,
}: {
  readonly onStop: () => Promise<void>;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setOpen] = useState(false);
  const [isPending, setPending] = useState(false);
  async function confirm(): Promise<void> {
    setPending(true);
    try {
      await onStop();
    } finally {
      setPending(false);
      setOpen(false);
    }
  }
  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <Button
        size="sm"
        variant="destructive-soft"
        className="h-10 min-h-10 px-4 text-[13px] font-semibold xl:min-h-10 xl:px-4 xl:text-[13px]"
        onClick={() => setOpen(true)}
      >
        {t("plans.console.stopRun")}
      </Button>
      <DialogContent>
        <DialogTitle className="text-base font-semibold">
          {t("plans.console.stopTitle")}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">
          {t("plans.console.stopDescription")}
        </DialogDescription>
        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button size="sm" variant="outline">
              {t("plans.console.stopCancel")}
            </Button>
          </DialogClose>
          <Button
            size="sm"
            variant="destructive"
            disabled={isPending}
            onClick={() => void confirm()}
          >
            {t("plans.console.confirmStop")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
