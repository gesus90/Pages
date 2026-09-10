import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { cn } from "@/app/lib/cn";

import type { ReactNode } from "react";

interface DetailSectionProps {
  readonly title: string;
  readonly icon?: ReactNode;
  readonly trailing?: ReactNode;
  readonly defaultOpen?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * Renders a collapsible, titled block used to group ticket details.
 *
 * @remarks
 * Jira-inspirierte Ticketansichten gliedern sich in mehrere kompakte,
 * einklappbare Blöcke statt einer einzigen Formularwand. Diese
 * gemeinsame Hülle hält Header, Chevron und Aufklapplogik an einer
 * Stelle, damit jeder Bereich (Key Details, Beschreibung,
 * Abnahmekriterien, Details, Entwicklung, Automatisierung,
 * Verknüpfungen) optisch konsistent bleibt.
 */
export function DetailSection({
  title,
  icon,
  trailing,
  defaultOpen = true,
  className,
  children,
}: DetailSectionProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section
      className={cn("rounded-2xl bg-surface p-4 shadow-xs sm:p-5", className)}
    >
      <button
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-3 text-left select-none"
        onClick={() => setIsOpen((previous) => !previous)}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-2">
          {isOpen ? (
            <ChevronDown
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          ) : (
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          {icon}
          <span className="truncate text-sm font-semibold text-foreground">
            {title}
          </span>
        </span>
        {trailing}
      </button>
      {isOpen ? <div className="mt-3.5">{children}</div> : null}
    </section>
  );
}
