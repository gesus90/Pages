import { cn } from "@/app/lib/cn";

import styles from "./quota-loading.module.css";

/**
 * The ring of a status line that says "wird geladen" or "wird aktualisiert".
 * @remarks
 * 12 px in `muted-foreground`, an open ring that turns once in 0.9 s. Where
 * the reader asks for less motion it stays a still ring. It stands in the
 * 14 px box of the status icons, so the text never moves when the ring
 * replaces another symbol.
 */
export function QuotaSpinner(): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      data-quota-spinner=""
      className="flex size-3.5 shrink-0 items-center justify-center"
    >
      <span
        className={cn(
          "block size-3 rounded-full border-[1.5px] border-muted-foreground/30 border-t-muted-foreground",
          styles.spinner,
        )}
      />
    </span>
  );
}
