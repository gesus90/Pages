import { ArrowLeft, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentSessionState } from "@/definition/AgentSessionJournal";

interface ConsoleHeaderProps {
  readonly title: string;
  readonly nodeType: string;
  readonly runs: readonly AgentPlanRun[];
  readonly run: AgentPlanRun | null;
  readonly provider: string | null;
  readonly state: AgentSessionState | null;
  readonly isReadOnly: boolean;
  readonly headingRef: React.RefObject<HTMLHeadingElement | null>;
  readonly onSelectRun: (id: string) => void;
  readonly onClose: () => void;
  /** Returns from a group member to the group's member list. */
  readonly onBack?: () => void;
}

/** Agent, node and run, provider, translated session state, run choice and close stay visible. */
export function ConsoleHeader(props: ConsoleHeaderProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <header className="flex flex-wrap items-start gap-3 border-b border-border px-5 py-4">
      {props.onBack ? (
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={props.onBack}
          aria-label={t("plans.console.backToGroup")}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Button>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">
          {t("plans.console.kicker", { type: props.nodeType })}
        </p>
        <h2
          ref={props.headingRef}
          tabIndex={-1}
          className="truncate text-lg font-semibold outline-none"
        >
          {props.title}
        </h2>
        <div
          role="status"
          className="mt-1 flex flex-wrap items-center gap-2 text-xs"
        >
          {props.provider ? (
            <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
              {t(`settings.agents.provider.${props.provider}`)}
            </span>
          ) : null}
          {props.state ? (
            <span className="rounded-md bg-info-subtle px-2 py-0.5 font-medium text-info">
              {t(`plans.console.state.${props.state}`)}
            </span>
          ) : null}
          {props.isReadOnly ? (
            <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
              {t("plans.console.readOnly")}
            </span>
          ) : null}
        </div>
      </div>
      {props.runs.length > 0 ? (
        <Select
          size="sm"
          className="w-full sm:w-64"
          ariaLabel={t("plans.console.run")}
          value={props.run?.id ?? ""}
          onValueChange={props.onSelectRun}
          options={props.runs.map((entry) => ({
            value: entry.id,
            label: `${entry.startedAt} · ${t(`plans.status.${entry.status}`)}`,
          }))}
        />
      ) : null}
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={props.onClose}
        aria-label={t("plans.console.close")}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </header>
  );
}
