/** Keeps control and menu keys away from React Flow's node selection and movement shortcuts. */
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
      "button, input, select, textarea, a, summary, [role^='menuitem'], [contenteditable='true']",
    )
  )
    event.stopPropagation();
}
