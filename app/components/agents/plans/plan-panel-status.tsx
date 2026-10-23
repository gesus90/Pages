import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { PlanPanelState, PlanPanelTone } from "./plan-panel-status-model";

const TONES: Readonly<Record<PlanPanelTone, string>> = {
  ready: "bg-success-subtle text-success",
  blocked: "bg-status-active-subtle text-status-active",
  active: "bg-info-subtle text-info",
  paused: "bg-muted text-foreground",
  neutral: "bg-muted text-muted-foreground",
  error: "bg-destructive-subtle text-destructive",
};

/**
 * The collapsed panel's single line: a status marker and one short sentence.
 *
 * @remarks
 * The line opens the details like the chevron does; opening them changes
 * neither the plan nor the run. Lists and causes stay in the details.
 */
export function PlanPanelStatus(props: {
  readonly state: PlanPanelState;
  readonly isOpen: boolean;
  readonly detailsId: string;
  readonly onToggle: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { state } = props;
  const base = `plans.panel.state.${state.state}`;
  return (
    <div role="status" className="px-4 pt-3.5 pb-4">
      <button
        type="button"
        aria-expanded={props.isOpen}
        aria-controls={props.detailsId}
        onClick={props.onToggle}
        className="flex max-w-full min-w-0 items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-11"
      >
        <span
          className={cn(
            "shrink-0 rounded-md px-2 py-1 text-xs leading-4 font-semibold",
            TONES[state.tone],
          )}
        >
          {t(`${base}.label`)}
        </span>
        <span className="min-w-0 text-xs text-foreground">
          {t(`${base}.hint`, { context: state.variant })}
        </span>
      </button>
    </div>
  );
}
