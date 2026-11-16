import { useTranslation } from "react-i18next";

import type { PlanRunLogTone } from "./plan-run-log-model";

/** The white symbol inside a filled mark, drawn like the check and cross of the node marks. */
const SYMBOL_CLASS =
  "fill-none stroke-plan-log-symbol [stroke-linecap:round] [stroke-linejoin:round]";

function MarkShape({
  tone,
}: {
  readonly tone: PlanRunLogTone;
}): React.ReactElement {
  if (tone === "success")
    return (
      <>
        <circle cx="8" cy="8" r="8" className="fill-plan-log-success" />
        <path
          d="M4.6 8.2 6.9 10.5 11.4 5.7"
          className={SYMBOL_CLASS}
          strokeWidth="2"
        />
      </>
    );
  if (tone === "error")
    return (
      <>
        <circle cx="8" cy="8" r="8" className="fill-plan-log-error" />
        <path
          d="M5.4 5.4 10.6 10.6M10.6 5.4 5.4 10.6"
          className={SYMBOL_CLASS}
          strokeWidth="2"
        />
      </>
    );
  if (tone === "warning")
    return (
      <>
        <path
          d="M8 .9c.55 0 1.03.29 1.3.77l6.45 11.5c.55.98-.16 2.18-1.3 2.18H1.55c-1.14 0-1.85-1.2-1.3-2.18L6.7 1.67C6.97 1.19 7.45.9 8 .9Z"
          className="fill-plan-log-warning"
        />
        <path d="M8 5.6v3.9" className={SYMBOL_CLASS} strokeWidth="2" />
        <circle cx="8" cy="12.2" r="1.1" className="fill-plan-log-symbol" />
      </>
    );
  return (
    <>
      <circle
        cx="8"
        cy="8"
        r="7.25"
        className="fill-none stroke-muted-foreground"
        strokeWidth="1.5"
      />
      <path
        d="M8 7.3v3.9"
        className="fill-none stroke-muted-foreground [stroke-linecap:round]"
        strokeWidth="1.6"
      />
      <circle cx="8" cy="5" r="0.95" className="fill-muted-foreground" />
    </>
  );
}

/**
 * The state of a run log entry as a filled mark with a spoken name.
 * @remarks
 * Success is a green circle with a white check, a warning a yellow triangle
 * with a white exclamation mark and an error a red circle with a white cross.
 * An entry that only informs keeps an outlined mark, so it never reads as a
 * success or a failure. The name is spoken, so the colour is not the only cue.
 */
export function PlanRunLogMark({
  tone,
}: {
  readonly tone: PlanRunLogTone;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <svg
      role="img"
      aria-label={t(`plans.panel.runLog.tone.${tone}`)}
      data-plan-log-mark={tone}
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
    >
      <MarkShape tone={tone} />
    </svg>
  );
}
