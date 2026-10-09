import { ChevronDown } from "lucide-react";

interface TicketCollapsibleProps {
  readonly title: string;
  readonly isInitiallyOpen?: boolean;
  readonly children: React.ReactNode;
}

/**
 * A detail area on the right of a ticket that opens and closes, as in Jira;
 * the native element keeps it usable with keyboard and screen readers.
 */
export function TicketCollapsible({
  title,
  isInitiallyOpen = true,
  children,
}: TicketCollapsibleProps): React.ReactElement {
  return (
    <details className="group rounded-xl bg-muted/40" open={isInitiallyOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          aria-hidden="true"
          className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4 text-xs">{children}</div>
    </details>
  );
}
