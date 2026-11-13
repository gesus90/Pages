import { Button } from "@/app/components/ui/button";

interface AgentTabFooterProps {
  /** The label of the button that closes the popup. */
  readonly closeLabel: string;
  readonly onClose: () => void;
  /** A line above the buttons, such as the result of the last change. */
  readonly notice?: React.ReactNode;
  /** Buttons at the start of the footer, such as "Jetzt träumen". */
  readonly start?: React.ReactNode;
  /** Buttons after the close button, such as "Speichern". */
  readonly children?: React.ReactNode;
}

/** The sticky footer of a tab: its own buttons at the start, "Abbrechen" or "Schließen" and the main button at the end. */
export function AgentTabFooter({
  closeLabel,
  onClose,
  notice,
  start,
  children,
}: AgentTabFooterProps): React.ReactElement {
  return (
    <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-6 py-4">
      {notice === undefined ? null : (
        <div className="flex basis-full flex-col gap-1">{notice}</div>
      )}
      <div className="flex flex-wrap items-center gap-2">{start}</div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <Button onClick={onClose} variant="outline">
          {closeLabel}
        </Button>
        {children}
      </div>
    </footer>
  );
}

interface AgentTabPlaceholderProps {
  readonly loadingText: string;
  /** Why the tab could not be read; `null` while it loads. */
  readonly failureText: string | null;
  readonly retryLabel: string;
  readonly closeLabel: string;
  readonly onRetry: () => void;
  readonly onClose: () => void;
}

/** The loading hint of a tab, or why it could not be read and the way to try again. */
export function AgentTabPlaceholder({
  loadingText,
  failureText,
  retryLabel,
  closeLabel,
  onRetry,
  onClose,
}: AgentTabPlaceholderProps): React.ReactElement {
  return (
    <>
      <div className="flex flex-col items-start gap-3 px-6 py-8">
        {failureText === null ? (
          <p className="text-sm text-muted-foreground" role="status">
            {loadingText}
          </p>
        ) : (
          <>
            <p className="text-sm text-destructive" role="alert">
              {failureText}
            </p>
            <Button onClick={onRetry} size="sm" variant="outline">
              {retryLabel}
            </Button>
          </>
        )}
      </div>
      <AgentTabFooter closeLabel={closeLabel} onClose={onClose} />
    </>
  );
}
