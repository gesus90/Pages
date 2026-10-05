import { useTranslation } from "react-i18next";

interface SetupProgressProps {
  /** Number of the current step, starting at 1. */
  readonly current: number;
  readonly total: number;
}

/** Renders the progress bar above the content of a wizard step. */
export function SetupProgress({
  current,
  total,
}: SetupProgressProps): React.ReactElement {
  const { t } = useTranslation();
  const label = t("setup.progress", { current, total });

  return (
    <div className="mb-8">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{label}</p>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={t("setup.progressLabel")}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current}
        aria-valuetext={label}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${(current / total) * 100}%` }}
        />
      </div>
    </div>
  );
}
