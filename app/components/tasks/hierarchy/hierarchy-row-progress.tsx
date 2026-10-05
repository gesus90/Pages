interface HierarchyRowProgressProps {
  readonly progress: number;
}

/** Renders the progress bar and percentage of a row. */
export function HierarchyRowProgress({
  progress,
}: HierarchyRowProgressProps): React.ReactElement {
  return (
    <>
      <span className="hidden w-28 shrink-0 md:inline">
        <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${progress}%` }}
          />
        </span>
      </span>
      <span className="hidden w-12 shrink-0 text-right text-xs font-medium text-foreground sm:inline">
        {progress} %
      </span>
    </>
  );
}
