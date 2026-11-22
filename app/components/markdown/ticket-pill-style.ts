import { statusDotClass } from "@/app/components/tasks/task-badges";
import { cn } from "@/app/lib/cn";

import type { TicketSummaryState } from "@/app/lib/wiki-ticket-summaries";

/**
 * The pill of a ticket link inside running text: 24 px high, 7 px radius,
 * strong border on the surface. Shared by the rendered page and the editor.
 */
export const TICKET_PILL_CLASS =
  "mx-px inline-flex h-6 max-w-full items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface px-2 align-middle text-[13px] leading-none font-semibold text-foreground no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=hidden]:cursor-not-allowed data-[state=hidden]:border-border data-[state=hidden]:font-medium data-[state=hidden]:text-muted-foreground data-[state=hidden]:opacity-70";

/** The status word beside the key; the color never stands alone. */
export const TICKET_PILL_STATUS_CLASS =
  "font-medium whitespace-nowrap text-muted-foreground";

/** The block card of a ticket on its own line: full width, 44 px high. */
export const TICKET_CARD_CLASS =
  "my-2 flex h-11 w-full min-w-0 items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 text-sm text-foreground no-underline hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=hidden]:cursor-not-allowed data-[state=hidden]:text-muted-foreground data-[state=hidden]:opacity-70 data-[state=hidden]:hover:bg-surface";

/** Key of the ticket inside the block card. */
export const TICKET_CARD_KEY_CLASS =
  "shrink-0 text-sm font-semibold whitespace-nowrap";

/** Title inside the block card, shortened with an ellipsis. */
export const TICKET_CARD_TITLE_CLASS =
  "min-w-0 flex-1 truncate text-[13px] font-normal text-foreground";

/** The status pill at the right end of the block card, 22 px high. */
export const TICKET_CARD_STATUS_CLASS =
  "inline-flex h-[22px] shrink-0 items-center rounded-md bg-muted px-2 text-xs font-medium whitespace-nowrap text-foreground";

/** The person at the right end of the block card. */
export const TICKET_CARD_PERSON_CLASS =
  "max-w-32 shrink-0 truncate text-xs text-muted-foreground";

/**
 * The status dot of a ticket link, 7 px, in the color of the ticket list.
 * @param state - What the link knows about its ticket.
 * @returns The classes of the dot; hidden tickets have none.
 */
export function ticketDotClass(state: TicketSummaryState): string {
  return cn(
    "inline-block size-[7px] shrink-0 rounded-full",
    state.status === "visible"
      ? statusDotClass(state.summary.statusKey)
      : "bg-muted-foreground/40",
    state.status === "hidden" && "hidden",
  );
}
