import { cn } from "@/app/lib/cn";

import type { ReactNode } from "react";

interface SettingsCardProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly className?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly wrapHeader?: boolean;
}

interface ProfileRowProps {
  readonly label: string;
  readonly children: ReactNode;
}

interface ControlRowProps {
  readonly label: string;
  readonly children: ReactNode;
}

/** The heading of a settings section with its icon. */
export function SettingsSectionHeader({
  icon,
  title,
  description,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description?: string;
}): React.ReactElement {
  return (
    <div className="pages-sticky-band sticky top-0 z-10 mb-4 -ml-2 -mr-4 pt-3 pb-2 pl-2 pr-4 sm:-mr-6 sm:pr-6 md:-mr-8 md:pr-8 xl:-mr-12 xl:pr-12">
      <span
        aria-hidden="true"
        className="pages-sticky-band-surface absolute inset-0 -z-10 bg-background after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-gradient-to-b after:from-background after:to-transparent"
      />
      <div className="flex items-center gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary"
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** A titled card that groups the controls of one settings topic. */
export function SettingsCard({
  icon,
  title,
  description,
  action,
  className,
  children,
  wrapHeader = false,
}: SettingsCardProps): React.ReactElement {
  return (
    <section
      className={cn(
        "rounded-2xl bg-surface p-4 shadow-card ring-1 ring-border/70 sm:p-5 xl:p-6",
        className,
      )}
    >
      <header
        className={cn(
          "flex items-start justify-between gap-3",
          wrapHeader && "flex-wrap",
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary"
            aria-hidden="true"
          >
            {icon}
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>

      <div className="mt-5">{children}</div>
    </section>
  );
}

/** A label and a value of the profile, side by side. */
export function ProfileRow({
  label,
  children,
}: ProfileRowProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="pages-selectable min-w-0 text-sm font-medium text-foreground">
        {children}
      </dd>
    </div>
  );
}

/** A label and the control that edits it, side by side. */
export function ControlRow({
  label,
  children,
}: ControlRowProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0 sm:w-64 sm:max-w-full">{children}</div>
    </div>
  );
}
