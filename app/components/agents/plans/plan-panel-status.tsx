import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type {
  PlanPanelAttention,
  PlanPanelState,
  PlanPanelTone,
} from "./plan-panel-status-model";

const TONES: Readonly<Record<PlanPanelTone, string>> = {
  ready: "bg-success-subtle text-success",
  blocked: "bg-status-active-subtle text-status-active",
  active: "bg-info-subtle text-info",
  paused: "bg-muted text-foreground",
  neutral: "bg-muted text-muted-foreground",
  error: "bg-destructive-subtle text-destructive",
  open: "bg-warning-subtle text-warning",
};

const DOTS: Readonly<Record<PlanPanelAttention, string>> = {
  warning: "bg-warning",
  error: "bg-destructive",
};

/**
 * The dot at the marker that says the collapsed panel hides a notice.
 *
 * @remarks
 * Colour alone does not tell it: the hidden text adds "Hinweise vorhanden"
 * to the name of the button.
 */
function AttentionDot({
  attention,
}: {
  readonly attention: PlanPanelAttention;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <span
        aria-hidden="true"
        data-plan-panel-attention={attention}
        className={cn(
          "absolute -top-[3px] -right-[3px] size-2 rounded-full ring-2 ring-surface",
          DOTS[attention],
        )}
      />
      <span className="sr-only">, {t("plans.panel.attention")}</span>
    </>
  );
}

/**
 * The status marker of the panel; open, it also says one short sentence.
 *
 * @remarks
 * The marker opens the details like the chevron does; opening them changes
 * neither the plan nor the run. Collapsed, only the marker is shown, with a
 * dot when the panel hides a warning or an error (PAGE-338). Lists and causes
 * stay in the details.
 */
export function PlanPanelStatus(props: {
  readonly state: PlanPanelState;
  readonly isOpen: boolean;
  readonly detailsId: string;
  /** What the collapsed panel hides; the open panel shows it itself. */
  readonly attention: PlanPanelAttention | null;
  readonly onToggle: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { state, isOpen } = props;
  const base = `plans.panel.state.${state.state}`;
  const attention = isOpen ? null : props.attention;
  return (
    <div role="status" className={cn("px-4 pb-4", isOpen ? "pt-3.5" : "pt-3")}>
      <button
        type="button"
        data-plan-panel-status
        aria-expanded={isOpen}
        aria-controls={props.detailsId}
        onClick={props.onToggle}
        className="flex max-w-full min-w-0 items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-11"
      >
        <span
          className={cn(
            "relative shrink-0 rounded-md px-2 py-1 text-xs leading-4 font-semibold",
            TONES[state.tone],
          )}
        >
          {t(`${base}.label`)}
          {attention ? <AttentionDot attention={attention} /> : null}
        </span>
        {isOpen ? (
          <span className="min-w-0 text-xs text-foreground">
            {t(`${base}.hint`, { context: state.variant })}
          </span>
        ) : null}
      </button>
    </div>
  );
}
