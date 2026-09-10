import { cn } from "@/app/lib/cn";

interface DashboardIconProps {
  readonly className?: string;
}

function IconFrame({
  children,
  className,
}: DashboardIconProps & {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <svg
      className={cn("size-5", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Document icon used for the open-tickets KPI card. */
export function DashboardDocumentIcon({
  className,
}: DashboardIconProps): React.ReactElement {
  return (
    <IconFrame className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </IconFrame>
  );
}

/** Clock icon used for the overdue KPI card. */
export function DashboardClockIcon({
  className,
}: DashboardIconProps): React.ReactElement {
  return (
    <IconFrame className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </IconFrame>
  );
}

/** Circular-arrows icon used for the in-progress KPI card. */
export function DashboardRefreshIcon({
  className,
}: DashboardIconProps): React.ReactElement {
  return (
    <IconFrame className={className}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </IconFrame>
  );
}

/** Folder icon used for the projects KPI card and project rows. */
export function DashboardFolderIcon({
  className,
}: DashboardIconProps): React.ReactElement {
  return (
    <IconFrame className={className}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </IconFrame>
  );
}

/** Rising trend arrow used in KPI delta lines. */
export function DashboardTrendUpIcon({
  className,
}: DashboardIconProps): React.ReactElement {
  return (
    <IconFrame className={className}>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </IconFrame>
  );
}

/** Flat trend line used for neutral KPI deltas. */
export function DashboardTrendFlatIcon({
  className,
}: DashboardIconProps): React.ReactElement {
  return (
    <IconFrame className={className}>
      <path d="M5 12h14" />
    </IconFrame>
  );
}

/** Right arrow used for panel header links. */
export function DashboardArrowRightIcon({
  className,
}: DashboardIconProps): React.ReactElement {
  return (
    <IconFrame className={className}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </IconFrame>
  );
}
