import { cn } from "@/app/lib/cn";

import type { ReactNode } from "react";

interface SettingsCardProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly className?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
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
    <div className="sticky top-0 z-10 -mx-2 mb-4 bg-gradient-to-b from-background from-55% via-background/90 via-78% to-transparent px-2 pt-3 pb-2 select-none">
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
}: SettingsCardProps): React.ReactElement {
  return (
    <section
      className={cn(
        "rounded-2xl bg-surface p-4 shadow-card ring-1 ring-border/70 sm:p-5 xl:p-6",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary"
            aria-hidden="true"
          >
            {icon}
          </span>
          <div className="min-w-0">
            <h3 className="select-none text-base font-semibold text-foreground">
              {title}
            </h3>
            <p className="mt-0.5 select-none text-sm leading-relaxed text-muted-foreground">
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
      <dt className="select-none text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm font-medium text-foreground">
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
      <span className="select-none text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0 sm:w-64 sm:max-w-full">{children}</div>
    </div>
  );
}
