/**
 * The one scrolling region of a preview.
 * @remarks
 * Head and notices stay in place; only this region scrolls, so the close
 * button is always reachable. It takes the focus, so the arrow and page keys
 * scroll the document.
 */
export function StoragePreviewScroller({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      aria-label={label}
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      role="region"
      tabIndex={0}
    >
      {children}
    </div>
  );
}
