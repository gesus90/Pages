/**
 * Keeps control and menu keys away from React Flow's node selection and movement shortcuts.
 *
 * @remarks
 * The options of a card's select list lie in a portal, but their keys still
 * reach the card through React.
 */
export function keepPlanControlKeys(
  event: React.KeyboardEvent<HTMLElement>,
): void {
  const target = event.target;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s")
    return;
  if (event.key === "Escape" || !(target instanceof Element)) return;
  if (target.closest("[data-plan-handle]")) return;
  if (
    target.closest(
      "button, input, select, textarea, a, summary, [role^='menuitem'], [role='option'], [role='listbox'], [contenteditable='true']",
    )
  )
    event.stopPropagation();
}
